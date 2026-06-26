import { mat4, vec3 } from 'gl-matrix'
import { createProgram, createQuad, createVideoTexture, uniforms } from '../gl-utils'
import spriteVert from '../shaders/sprite.vert?raw'
import spriteFrag from '../shaders/sprite.frag?raw'
import type { Face, Frame, Framing, Mouth, Pose, SceneNode } from '../types'
import { StreamingClip, LoopClip, type ClipSource, webCodecsSupported } from '../../webcodecs/ClipDecoder'

// Monet's body: a billboarded stacked-alpha sprite (docs/008 + docs/016). Two clip slots
// cross-dissolve in a single premultiplied draw — ported from the proven /preview Stage so
// the character never goes translucent at a clip seam. The director (Whiteroom) calls
// setClip(); this node knows nothing about the FSM.
//
// Decoding is WebCodecs, not <video>: setting video.currentTime updates instantly but the
// <video> paints the seeked frame ~1 frame late, which is invisible for the pose overlay
// but GLARING for the mouth erase (the polygon drifts off the lips). A StreamingClip decodes
// to exact, presentation-ordered frames and tells us the index it's showing, so the erase
// polygon and the picture are the same frame by construction. See
// [[monet-webcodecs-mouth-compositing]]. Frames are streamed (decode-as-you-go, ~a few MB)
// so a mobile decoder doesn't stall on a 150 MB all-frames cache.

const QUAD_H = 3.0 // world height of the reference billboard box — sets Monet's size
const QUAD: [number, number] = [QUAD_H, QUAD_H] // square; per-clip framing is resolved in the shader
// Feet baseline (= the proven /preview Stage value). The clip's feet anchor sits at
// ~0.87 of the frame, with the soles below it; 0.87 leaves that room so the whole
// foot renders down to the frame bottom instead of being clipped at the floor line.
const BASE: [number, number] = [0.5, 0.87]
const FPS = 24 // all Monet clips are 24fps
// Savitzky-Golay (window 9, polyorder 3) smoothing weights (Σ = 231). Same de-jitter as the
// SAM-3D rig (experiments/sam3d-body/smooth_rig.py `savgol`); applied over a SYMMETRIC window
// (past + future frames, all preloaded) → zero-phase, no lag (unlike a causal EMA).
const SG9 = [-21, 14, 39, 54, 59, 54, 39, 14, -21]
const BLEND_MS = 420 // default clip-to-clip cross-dissolve
// Head-pat reaction = a self-contained boomerang loop clip (monet-headpat-loop, baked from
// lookup-3's happy head-sway: forward then reversed → seamless). It plays FORWARD and loops,
// so there's no backward scrub (which restarted the single-GOP decoder every frame and stalled
// on mobile) and no per-frame bookkeeping. Hard cut in (frame 0 is a keyframe = instant,
// already a looking-up pose); release cross-dissolves back to idle.
const REACT_ENTER_BLEND_MS = 0 // 0 = hard cut into the head-pat loop (snap, no ghost, no decode wait)

type Slot = {
  clip: ClipSource | null // decoded source: StreamingClip (normal) or LoopClip (head-pat loop); null until ready
  tex: WebGLTexture
  anc: [number, number] // feet anchor: x from left, y from top (normalized)
  scl: number // framing scale
  fas: number // frame aspect (frameW / frameH) — fallback if clip dims unknown
  pose: Pose | null // this clip's per-frame pose (drives the contact shadow); may arrive late
  mouth: Mouth | null // this clip's per-frame mouth polygon (erased in the shader); may arrive late
  face: Face | null // this clip's per-frame face landmarks (mouth corners → rigged-mouth tilt); may arrive late
  mouthTilt: number // EMA-smoothed rigged-mouth tilt (radians) — kills single-frame kp outliers
  poly: Float32Array // scratch buffer (16 vec2) reused each frame to upload the mouth uniform
  startMs: number // play-clock origin (-1 = not started; set when the clip's first frame is ready)
  idx: number // current frame index from the clock
  shownIdx: number // index of the frame texImage2D actually uploaded (locks mouth/pose to the picture)
  token: number // guard so a late clip/pose/mouth fetch can't overwrite a newer clip
  rigMode: 'on' | 'off' | 'talk' // on = always rig; off = never; talk = native, rig only while rigActive
}

export class CharacterNode implements SceneNode {
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private buf: WebGLBuffer
  private u: Record<string, WebGLUniformLocation | null>
  private slots: Slot[]
  private active = 0
  private mix = 0 // weight of slot 1 (0 → slot 0 only)
  private mixTarget = 0
  private mixFrom = 0
  private blendStart = 0
  private blendMs = BLEND_MS
  private pending = -1
  private endedFired = false
  private first = true
  pos: [number, number, number] = [0, 0, 0]
  // Injected by the director (Whiteroom) or a lab; returns 0..1 lip-sync openness each frame.
  // null → mouth stays closed (the mouthless baseline). See [[monet-webcodecs-mouth-compositing]].
  mouthOpenSource: (() => number) | null = null
  // Viseme horizontal-radius multiplier (1 = neutral). Set alongside mouthOpenSource by a
  // viseme driver; null → 1 (the v0 amplitude-only oval). See [[monet-webcodecs-mouth-compositing]].
  mouthWideSource: (() => number) | null = null
  // Active viseme ids (current `a`, next `b`, cross-fade `blend`) for SPRITE rendering. Set by a
  // viseme driver; when set AND the atlas is loaded, sprite.frag samples the viseme atlas cell
  // for the active mouth instead of the procedural ellipse. null → procedural.
  mouthVisemeSource: (() => { a: number; b: number; blend: number }) | null = null
  // True while she's speaking. A clip with rigMode 'talk' shows its NATIVE baked mouth normally
  // and only erases+composites the rigged mouth when this is on. Set by the director (Whiteroom).
  rigActive = false
  private atlas: WebGLTexture | null = null // mouth-atlas.png (5×4 mouth sprites); lazy-loaded
  private atlasReady = false
  mouthSpriteScale = 89 // full mouth-sprite (cell) width in BASE (1024²) pixels; 1.0 v_uv = 1184 base-px
  mouthSpriteY = -3.5 // vertical nudge of the mouth in BASE pixels (+ = down) from the painted anchor row
  mouthEraseDilate = 5.5 // erase mask dilation in BASE (1024²) pixels — how far past the SAM3 poly
  mouthEraseFeather = 3.5 // erase mask outward feather in BASE pixels
  edgeFeather = 0 // silhouette alpha-edge feather, frame-space (>0 only in the desktop overlay); 0 = off
  // Sprite anchor source: 'center' = mouth.json box centre (bobs with the original mouth),
  // 'top' = box top (upper lip, no face-kp noise), 'corners' = face-rig corner midpoint.
  mouthAnchorMode: 'center' | 'top' | 'corners' = 'corners'
  onClipEnd: (() => void) | null = null
  onReactionEnd: (() => void) | null = null
  private loopSlot = -1 // slot playing the looping head-pat reaction (-1 = none)
  private headPatClip: LoopClip | null = null // the head-pat loop, prebaked once and kept warm (reused per tap)
  // last frame's camera basis, stashed in draw() so headScreenPos() can project between frames
  private vView: mat4 | null = null
  private vProj: mat4 | null = null
  private vRight: vec3 | null = null
  private mvp = mat4.create()
  private ndc = vec3.create()

  constructor(private gl: WebGL2RenderingContext, _container: HTMLElement) {
    if (!webCodecsSupported()) console.warn('CharacterNode: WebCodecs unavailable — character will not render')
    this.prog = createProgram(gl, spriteVert, spriteFrag)
    this.buf = createQuad(gl, true)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.u = uniforms(gl, this.prog, [
      'u_view', 'u_proj', 'u_pos', 'u_quad', 'u_right', 'u_feet', 'tA', 'tB', 'mixv', 'feather',
      'quadAspect', 'ancA', 'ancB', 'base', 'sclA', 'sclB', 'fasA', 'fasB', 'u_ambient',
      'uMouthA', 'uMouthB', 'uSkinA', 'uSkinB', 'uBoxA', 'uBoxB', 'uHasA', 'uHasB', 'uMargin', 'uMouthFeather', 'uMouthOpen',
      'uMouthAngleA', 'uMouthAngleB', 'uMouthWide', 'uEdgeFeather',
      'uAtlas', 'uMouthSprite', 'uVisemeA', 'uVisemeB', 'uVisemeBlend', 'uSpriteScale', 'uSpriteAnchorY', 'uSpriteYOffset',
      'uMouthAnchorA', 'uMouthAnchorB',
    ])
    // Viseme sprite atlas — 5×4 grid of mouth shapes (contents/monet/mouth-atlas.png). Loaded
    // once; until then mouthVisemeSource falls back to the procedural ellipse.
    this.atlas = gl.createTexture()
    const img = new Image()
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, this.atlas)
      // Premultiply on upload so LINEAR filtering across the mouth's alpha edge doesn't bleed
      // the transparent (black) RGB inward → no dark fringe. Mipmaps kill minification aliasing
      // (the ~100px atlas mouth is drawn at ~48px). Reset the flag so the per-frame video
      // uploads stay straight-alpha (the shader premultiplies those itself).
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.atlasReady = true
    }
    img.src = '/contents/monet/mouth-atlas.webp'
    this.slots = [0, 1].map(() => ({
      clip: null as ClipSource | null,
      tex: createVideoTexture(gl),
      anc: [0.5, 0.87] as [number, number],
      scl: 1,
      fas: 1,
      pose: null as Pose | null,
      mouth: null as Mouth | null,
      face: null as Face | null,
      mouthTilt: 0,
      poly: new Float32Array(32),
      startMs: -1,
      idx: 0,
      shownIdx: 0,
      token: 0,
      rigMode: 'on' as 'on' | 'off' | 'talk',
    }))
  }

  private params(f: Framing): { anc: [number, number]; scl: number; fas: number } {
    const [fw, fh] = f.frame
    const anc: [number, number] = [(f.origin?.[0] ?? fw * 0.5) / fw, (f.origin?.[1] ?? fh * 0.87) / fh]
    return { anc, scl: f.scale ?? 1, fas: fw / fh }
  }

  // frame aspect read LIVE from the decoded clip (frameW / color-half-height) so a reused
  // slot picks up its new clip's true shape; falls back to the framing value.
  private fas(s: Slot): number {
    const c = s.clip
    return c && c.width && c.height ? c.width / (c.height / 2) : s.fas
  }

  // pose/mouth may be a Promise (the JSON fetch races the clip load) — assigned to the slot
  // when it resolves, guarded so a later clip reusing the slot wins.
  setClip(
    src: string,
    framing: Framing,
    pose?: Promise<Pose | null> | Pose | null,
    mouth?: Promise<Mouth | null> | Mouth | null,
    face?: Promise<Face | null> | Face | null,
    opts?: { blendMs?: number; loop?: boolean; rigMode?: 'on' | 'off' | 'talk' },
  ): number {
    this.loopSlot = -1 // a plain clip cancels any head-pat loop (playReaction re-arms it)
    this.blendMs = opts?.blendMs ?? BLEND_MS // per-transition cross-dissolve (0 = hard cut)
    const p = this.params(framing)
    const slot = this.first ? 0 : 1 - this.active
    const s = this.slots[slot]
    Object.assign(s, p)
    s.pose = null
    s.mouth = null
    s.face = null
    s.mouthTilt = 0
    s.rigMode = opts?.rigMode ?? 'on'
    s.startMs = -1 // clock (re)starts when this clip's first frame decodes
    s.idx = 0
    s.shownIdx = 0
    const tok = ++s.token // one guard for this clip's late clip + pose + mouth loads
    if (s.clip && s.clip !== this.headPatClip) s.clip.close() // keep the warm head-pat loop alive across taps
    s.clip = null
    Promise.resolve(pose ?? null).then((pd) => {
      if (s.token === tok) s.pose = pd
    })
    Promise.resolve(mouth ?? null).then((md) => {
      if (s.token === tok) s.mouth = md
    })
    Promise.resolve(face ?? null).then((fd) => {
      if (s.token === tok) s.face = fd
    })
    // A looping head-pat clip is short → prebake to bitmaps (smooth mobile loop); everything
    // else streams (mouth-exact, low memory). Both satisfy ClipSource.
    const load: Promise<ClipSource> = opts?.loop ? LoopClip.create(src, FPS) : StreamingClip.create(src, FPS)
    load
      .then((clip) => {
        if (s.token !== tok) {
          clip.close() // superseded by a newer setClip on this slot
          return
        }
        s.clip = clip
        if (opts?.loop && clip instanceof LoopClip) this.headPatClip = clip // cache the cold-loaded loop, warm next tap
      })
      .catch((e) => console.error('CharacterNode: clip load failed', src, e))
    if (this.first) {
      this.first = false
      this.active = 0
      this.mix = 0
      this.mixTarget = 0
      this.endedFired = false
      return slot
    }
    this.pending = slot // the update loop blends to it once it's decoding
    return slot
  }

  // ── head-pat reaction ──────────────────────────────────────────────────────
  // A touch on her head plays the boomerang loop clip (a happy head-sway) on a forward loop,
  // hard-cut in. release() ends it; the director then cross-dissolves back to idle. No frame
  // bookkeeping — the sway is baked into the clip, we just loop it (update() wraps the index).
  playReaction(src: string, framing: Framing, pose?: Promise<Pose | null> | Pose | null) {
    // Reuse the preloaded warm loop (instant). Only if a tap beats the preload do we cold-load.
    if (this.headPatClip?.ready) this.loopSlot = this.mountWarm(framing, this.headPatClip)
    else this.loopSlot = this.setClip(src, framing, pose, undefined, undefined, { blendMs: REACT_ENTER_BLEND_MS, loop: true })
  }

  // Prebake the head-pat loop once (call at startup) and keep it warm, so a tap pays no
  // fetch+decode. Idempotent; a no-op once loaded or if WebCodecs is unavailable.
  preloadHeadPat(src: string) {
    if (this.headPatClip || !webCodecsSupported()) return
    LoopClip.create(src, FPS)
      .then((c) => {
        this.headPatClip = c
      })
      .catch((e) => console.error('CharacterNode: head-pat preload failed', src, e))
  }

  // Drop an already-decoded clip straight into a slot and start the hard-cut transition,
  // skipping setClip's async load — so a warm reuse shows its first frame the same frame.
  private mountWarm(framing: Framing, clip: ClipSource): number {
    const p = this.params(framing)
    const slot = this.first ? 0 : 1 - this.active
    const s = this.slots[slot]
    Object.assign(s, p)
    s.pose = null
    s.mouth = null
    s.startMs = -1
    s.idx = 0
    s.shownIdx = 0
    ++s.token // invalidate any in-flight pose/mouth fetch for this slot
    if (s.clip && s.clip !== this.headPatClip) s.clip.close()
    s.clip = clip
    this.blendMs = REACT_ENTER_BLEND_MS
    if (this.first) {
      this.first = false
      this.active = 0
      this.mix = 0
      this.mixTarget = 0
      this.endedFired = false
      return slot
    }
    this.pending = slot
    return slot
  }

  // The finger lifted or left her head — stop looping and hand back to the FSM (it resumes idle).
  release() {
    if (this.loopSlot >= 0) {
      this.loopSlot = -1
      this.onReactionEnd?.()
    }
  }

  isReacting(): boolean {
    return this.loopSlot >= 0
  }

  // Where her head is on screen (0..1, y-down) + a generous hit radius, projecting the active
  // clip's face anchor through the billboard (inverts sprite.frag stk + sprite.vert). null when
  // the clip has no pose or hasn't drawn yet. The director uses it to hit-test a touch.
  headScreenPos(): { x: number; y: number; r: number } | null {
    const s = this.slots[this.active]
    const pose = s.pose
    if (!pose?.poses?.length || s.startMs < 0 || !this.vView || !this.vProj || !this.vRight) return null
    const fr = pose.poses[Math.max(0, Math.min(pose.poses.length - 1, s.shownIdx))]
    if (!fr) return null
    const k = s.scl
    const fas = this.fas(s)
    const ax = 0.5 + (fr.face[0] - s.anc[0]) * k * fas // face-u → quad a_pos (quadAspect = 1)
    const ay = 1 - (BASE[1] + (fr.face[1] - s.anc[1]) * k)
    const fx = (ax - 0.5) * QUAD[0]
    const fy = (ay - (1 - BASE[1])) * QUAD[1]
    mat4.multiply(this.mvp, this.vProj, this.vView)
    const project = (worldFx: number) => {
      const w = vec3.fromValues(this.pos[0] + this.vRight![0] * worldFx, this.pos[1] + fy, this.pos[2] + this.vRight![2] * worldFx)
      vec3.transformMat4(this.ndc, w, this.mvp)
      return [this.ndc[0] * 0.5 + 0.5, 1 - (this.ndc[1] * 0.5 + 0.5)] as const
    }
    const [cx, cy] = project(fx)
    const worldR = 0.18 * k * fas * QUAD[0] // ~0.18 of frame height as a head radius (generous)
    const [ex] = project(fx + worldR)
    return { x: cx, y: cy, r: Math.max(0.06, Math.abs(ex - cx)) }
  }

  // World-x offset (along the billboard right vector) of the active clip's center of mass
  // for the current frame — where the contact shadow should sit relative to the feet. null
  // when this clip has no pose data. Derived by inverting the sprite shader.
  groundOffset(): number | null {
    const s = this.slots[this.active]
    const pose = s.pose
    if (!pose || !pose.poses.length || s.startMs < 0) return null
    const n = pose.poses.length
    const idx = Math.max(0, Math.min(n - 1, s.shownIdx))
    const fr = pose.poses[idx]
    if (!fr) return null
    return (fr.com[0] - s.anc[0]) * s.scl * this.fas(s) * QUAD[1]
  }

  // Per-slot mouth-erase uniforms for the slot's current shown frame. Fills the slot's
  // scratch `poly` buffer (16 vec2, u-space) and returns skin/box/has; has=0 → shader leaves
  // the mouth untouched. Indexed by the frame texImage2D actually uploaded → exact lock.
  private mouthAt(s: Slot): { skin: [number, number, number]; box: [number, number, number, number]; has: number } {
    const md = s.mouth
    const off = { skin: [0, 0, 0] as [number, number, number], box: [0, 0, 0, 0] as [number, number, number, number], has: 0 }
    if (!md || !md.frames.length || !s.clip) return off
    const fr = md.frames[Math.max(0, Math.min(md.frames.length - 1, s.shownIdx))]
    if (!fr || !fr.poly) return off
    const p = s.poly
    for (let i = 0; i < 16; i++) {
      p[i * 2] = fr.poly[i][0]
      p[i * 2 + 1] = fr.poly[i][1]
    }
    return { skin: [fr.skin[0] / 255, fr.skin[1] / 255, fr.skin[2] / 255], box: fr.box, has: 1 }
  }

  // Rigged-mouth tilt for the slot's shown frame: the angle of the mouth-corner line
  // (kp 24 = left → kp 26 = right) from face.json, so the composited mouth rotates with the
  // head. The 28-pt kp are noisy on this chibi (a few frames flip the corners → ±180°), so we
  // gate on corner confidence, reject anything past ±0.5rad (real head tilt is ≤ ~30°), and
  // EMA-smooth per slot — a single bad frame can't snap the mouth. Falls back to untilted.
  private mouthAngle(s: Slot): number {
    const fr = s.face?.faces?.[Math.max(0, s.shownIdx)]
    let target = s.mouthTilt // hold last on a missing / low-confidence / outlier frame
    if (fr?.kp) {
      const l = fr.kp[24]
      const r = fr.kp[26]
      if (l && r && l[2] >= 0.5 && r[2] >= 0.5) {
        const a = Math.atan2(r[1] - l[1], r[0] - l[0])
        if (Math.abs(a) <= 0.5) target = a // reject the ±180° corner-flip outliers
      }
    }
    s.mouthTilt += (target - s.mouthTilt) * 0.25
    return s.mouthTilt
  }

  // Stable mouth anchor (u-space) for the sprite: the midpoint of the face-rig mouth CORNERS
  // (kp 24,26) — they barely move as the jaw drops, so far steadier than the mouth.json box
  // center (which bobs with the original clip's open/close). The sprite pins its UPPER lip here
  // and opens downward. Smoothed with a **zero-phase Savitzky-Golay** (w=9,p=3) over a SYMMETRIC
  // window of the (already fully-loaded) per-frame data — past AND future frames, so there's no
  // lag (unlike a causal EMA, which trailed and flew the mouth in). Same method as the SAM-3D
  // rig de-jitter (experiments/sam3d-body/smooth_rig.py).
  private mouthAnchor(s: Slot, box: [number, number, number, number]): [number, number] {
    if (box[2] <= box[0]) return [0, 0] // no mouth box yet (loading) → sprite isn't drawn anyway
    const corners = this.mouthAnchorMode === 'corners'
    const top = this.mouthAnchorMode === 'top'
    // Per-frame raw anchor for frame j: face corners (corners mode) else the mouth.json box.
    const at = (j: number): [number, number] | null => {
      if (corners) {
        const fr = s.face?.faces?.[j]
        const l = fr?.kp?.[24]
        const r = fr?.kp?.[26]
        if (l && r && l[2] >= 0.4 && r[2] >= 0.4) return [(l[0] + r[0]) * 0.5, (l[1] + r[1]) * 0.5]
      }
      const mb = s.mouth?.frames?.[j]?.box
      if (mb && mb[2] > mb[0]) return [(mb[0] + mb[2]) * 0.5, top ? mb[1] : (mb[1] + mb[3]) * 0.5]
      return null
    }
    const F = s.face?.faces?.length ?? s.mouth?.frames?.length ?? (s.clip?.total ?? 1)
    const i = Math.min(Math.max(0, s.shownIdx), F - 1)
    let sx = 0, sy = 0, sw = 0
    for (let k = -4; k <= 4; k++) {
      const p = at(Math.min(Math.max(i + k, 0), F - 1))
      if (!p) continue
      const w = SG9[k + 4]
      sx += p[0] * w; sy += p[1] * w; sw += w
    }
    if (sw !== 0) return [sx / sw, sy / sw]
    return [(box[0] + box[2]) * 0.5, top ? box[1] : (box[1] + box[3]) * 0.5] // fallback: this frame's box
  }

  update({ now }: Frame) {
    // Advance each slot's play clock; start it when the clip's first frame is ready. The
    // index holds at the last frame (clamped) once the clip plays out — like a paused-at-end
    // <video> — until the director swaps in a new clip. The reaction slot is driven by the
    // touch state machine instead (advanceReaction).
    for (const s of this.slots) {
      if (!s.clip) continue
      if (s.startMs < 0) {
        if (s.clip.ready) s.startMs = now
        else continue
      }
      const total = s.clip.total
      if (this.loopSlot >= 0 && this.slots[this.loopSlot] === s) {
        s.idx = Math.floor(((now - s.startMs) / 1000) * FPS) % total // forward loop (wrap)
      } else {
        s.idx = Math.min(total - 1, Math.floor(((now - s.startMs) / 1000) * FPS))
      }
    }
    // Start the transition once the incoming clip actually has a frame.
    if (this.pending >= 0 && this.slots[this.pending].clip?.ready) {
      this.mixFrom = this.mix
      this.mixTarget = this.pending // 0 or 1
      this.blendStart = now
      this.active = this.pending
      this.pending = -1
      this.endedFired = false
    }
    if (this.mix !== this.mixTarget) {
      const t = this.blendMs > 0 ? Math.min(1, (now - this.blendStart) / this.blendMs) : 1 // 0 = hard cut
      const e = t * t * (3 - 2 * t)
      this.mix = t >= 1 ? this.mixTarget : this.mixFrom + (this.mixTarget - this.mixFrom) * e
    }
    // Fire onClipEnd once when the active clip reaches its last frame. Suppressed while the
    // head-pat loop owns the playhead — it ends via release()/onReactionEnd, not the clock.
    if (this.loopSlot < 0 && this.pending < 0 && !this.endedFired) {
      const a = this.slots[this.active]
      if (a.clip && a.startMs >= 0 && a.idx >= a.clip.total - 1) {
        this.endedFired = true
        this.onClipEnd?.()
      }
    }
  }

  draw({ gl, view, proj, right, ambient }: Frame) {
    this.vView = view // stash for headScreenPos() projection between frames
    this.vProj = proj
    this.vRight = right
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniformMatrix4fv(this.u.u_view, false, view)
    gl.uniformMatrix4fv(this.u.u_proj, false, proj)
    gl.uniform3fv(this.u.u_pos, this.pos)
    gl.uniform2fv(this.u.u_quad, QUAD)
    gl.uniform1f(this.u.u_feet, 1 - BASE[1]) // pin the feet anchor to the floor
    gl.uniform3fv(this.u.u_right, right as Float32Array)
    gl.uniform3fv(this.u.u_ambient, ambient as Float32Array)
    gl.uniform1f(this.u.u_feather, 0.04)
    gl.uniform1f(this.u.uEdgeFeather, this.edgeFeather)
    gl.uniform1f(this.u.quadAspect, QUAD[0] / QUAD[1])
    gl.uniform2fv(this.u.base, BASE)
    gl.uniform1f(this.u.mixv, this.mix)
    // Upload each slot's current frame (slot 0 → tA, slot 1 → tB). A slot with no clip /
    // no decoded frame keeps its 1×1 placeholder (alpha 0), contributing nothing to the mix.
    // Drive streaming decode toward idx and lock the slot's mouth/pose to the shown frame.
    const upload = (unit: number, s: Slot) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, s.tex)
      if (!s.clip) return
      const got = s.clip.frameAt(s.idx)
      if (!got) return
      s.shownIdx = got.index
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, got.frame)
    }
    upload(0, this.slots[0])
    upload(1, this.slots[1])
    gl.uniform1i(this.u.tA, 0)
    gl.uniform1i(this.u.tB, 1)
    gl.uniform2fv(this.u.ancA, this.slots[0].anc)
    gl.uniform1f(this.u.sclA, this.slots[0].scl)
    gl.uniform1f(this.u.fasA, this.fas(this.slots[0]))
    gl.uniform2fv(this.u.ancB, this.slots[1].anc)
    gl.uniform1f(this.u.sclB, this.slots[1].scl)
    gl.uniform1f(this.u.fasB, this.fas(this.slots[1]))
    // Mouth erase: fill each slot's scratch poly buffer, then upload its 16-gon + skin.
    // rigMode gates whether the rig is live: 'on' always, 'talk' only while speaking (rigActive),
    // else the clip keeps its native baked mouth (has=0 → no erase/composite).
    const rigOn = (s: Slot) => s.rigMode === 'on' || (s.rigMode === 'talk' && this.rigActive)
    const mA = this.mouthAt(this.slots[0])
    const mB = this.mouthAt(this.slots[1])
    gl.uniform2fv(this.u.uMouthA, this.slots[0].poly)
    gl.uniform3fv(this.u.uSkinA, mA.skin)
    gl.uniform4fv(this.u.uBoxA, mA.box)
    gl.uniform1f(this.u.uHasA, rigOn(this.slots[0]) ? mA.has : 0)
    gl.uniform2fv(this.u.uMouthB, this.slots[1].poly)
    gl.uniform3fv(this.u.uSkinB, mB.skin)
    gl.uniform4fv(this.u.uBoxB, mB.box)
    gl.uniform1f(this.u.uHasB, rigOn(this.slots[1]) ? mB.has : 0)
    // Mouth erase reach (u-space; frame is 640px so 1.0 = 640px). Erase is solid out to
    // uMargin (~10px dilation), then feathers OUTWARD over uMouthFeather (~5px).
    // Erase dilation/feather are authored in BASE (1024²) pixels → convert to the active clip's
    // u-space: u = px / frameH, where frameH = scl·1184 (the framing's reference-frame height).
    // Base px are placed 1:1 in every framing, so this keeps the on-screen erase constant.
    const eraseU = 1 / ((this.slots[this.active].scl || 1) * 1184)
    gl.uniform1f(this.u.uMargin, this.mouthEraseDilate * eraseU)
    gl.uniform1f(this.u.uMouthFeather, this.mouthEraseFeather * eraseU)
    const open = this.mouthOpenSource ? Math.min(1, Math.max(0, this.mouthOpenSource())) : 0
    gl.uniform1f(this.u.uMouthOpen, open)
    const wide = this.mouthWideSource ? this.mouthWideSource() : 1
    gl.uniform1f(this.u.uMouthWide, wide)
    // Viseme sprite: when a viseme driver is set and the atlas is loaded, sample atlas cells
    // (slot 2) for the active mouth (cross-fading a→b); else uMouthSprite=0 → procedural ellipse.
    const vis = this.mouthVisemeSource && this.atlasReady ? this.mouthVisemeSource() : null
    gl.uniform1f(this.u.uMouthSprite, vis ? 1 : 0)
    if (vis) {
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.atlas)
      gl.uniform1i(this.u.uAtlas, 2)
      gl.uniform1f(this.u.uVisemeA, vis.a)
      gl.uniform1f(this.u.uVisemeB, vis.b)
      gl.uniform1f(this.u.uVisemeBlend, vis.blend)
      // base-px → v_uv (1.0 v_uv = 1184 base-px, constant across framings since the quad holds the
      // character at a fixed on-screen size). Anchor cell row is the painted upper-lip line (fixed);
      // the per-base-px vertical nudge rides on top.
      gl.uniform1f(this.u.uSpriteScale, this.mouthSpriteScale / 1184)
      gl.uniform1f(this.u.uSpriteAnchorY, 0.45)
      gl.uniform1f(this.u.uSpriteYOffset, this.mouthSpriteY / 1184)
    }
    gl.uniform1f(this.u.uMouthAngleA, this.mouthAngle(this.slots[0]))
    gl.uniform1f(this.u.uMouthAngleB, this.mouthAngle(this.slots[1]))
    // Stable sprite anchor per slot (face-corner midpoint; box center fallback).
    gl.uniform2fv(this.u.uMouthAnchorA, this.mouthAnchor(this.slots[0], mA.box))
    gl.uniform2fv(this.u.uMouthAnchorB, this.mouthAnchor(this.slots[1], mB.box))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose() {
    this.headPatClip?.close() // the warm loop isn't owned by a slot's lifecycle
    this.headPatClip = null
    this.slots.forEach((s) => {
      if (s.clip && s.clip !== this.headPatClip) s.clip.close()
      this.gl.deleteTexture(s.tex)
    })
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.buf)
  }
}
