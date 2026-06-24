import { createProgram, createQuad, createVideoTexture, uniforms } from '../gl-utils'
import spriteVert from '../shaders/sprite.vert?raw'
import spriteFrag from '../shaders/sprite.frag?raw'
import type { Frame, Framing, Mouth, Pose, SceneNode } from '../types'
import { StreamingClip, webCodecsSupported } from '../../webcodecs/ClipDecoder'

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

type Slot = {
  clip: StreamingClip | null // decoded source for this slot (loads async; null until ready)
  tex: WebGLTexture
  anc: [number, number] // feet anchor: x from left, y from top (normalized)
  scl: number // framing scale
  fas: number // frame aspect (frameW / frameH) — fallback if clip dims unknown
  pose: Pose | null // this clip's per-frame pose (drives the contact shadow); may arrive late
  mouth: Mouth | null // this clip's per-frame mouth polygon (erased in the shader); may arrive late
  poly: Float32Array // scratch buffer (16 vec2) reused each frame to upload the mouth uniform
  startMs: number // play-clock origin (-1 = not started; set when the clip's first frame is ready)
  idx: number // current frame index from the clock
  shownIdx: number // index of the frame texImage2D actually uploaded (locks mouth/pose to the picture)
  token: number // guard so a late clip/pose/mouth fetch can't overwrite a newer clip
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
  private blendMs = 420
  private pending = -1
  private endedFired = false
  private first = true
  pos: [number, number, number] = [0, 0, 0]
  onClipEnd: (() => void) | null = null

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
      'uMouthA', 'uMouthB', 'uSkinA', 'uSkinB', 'uBoxA', 'uBoxB', 'uHasA', 'uHasB', 'uMargin', 'uMouthFeather',
    ])
    this.slots = [0, 1].map(() => ({
      clip: null as StreamingClip | null,
      tex: createVideoTexture(gl),
      anc: [0.5, 0.87] as [number, number],
      scl: 1,
      fas: 1,
      pose: null as Pose | null,
      mouth: null as Mouth | null,
      poly: new Float32Array(32),
      startMs: -1,
      idx: 0,
      shownIdx: 0,
      token: 0,
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
  ) {
    const p = this.params(framing)
    const slot = this.first ? 0 : 1 - this.active
    const s = this.slots[slot]
    Object.assign(s, p)
    s.pose = null
    s.mouth = null
    s.startMs = -1 // clock (re)starts when this clip's first frame decodes
    s.idx = 0
    s.shownIdx = 0
    const tok = ++s.token // one guard for this clip's late clip + pose + mouth loads
    s.clip?.close()
    s.clip = null
    Promise.resolve(pose ?? null).then((pd) => {
      if (s.token === tok) s.pose = pd
    })
    Promise.resolve(mouth ?? null).then((md) => {
      if (s.token === tok) s.mouth = md
    })
    StreamingClip.create(src, FPS)
      .then((clip) => {
        if (s.token !== tok) {
          clip.close() // superseded by a newer setClip on this slot
          return
        }
        s.clip = clip
      })
      .catch((e) => console.error('CharacterNode: clip load failed', src, e))
    if (this.first) {
      this.first = false
      this.active = 0
      this.mix = 0
      this.mixTarget = 0
      this.endedFired = false
      return
    }
    this.pending = slot // the update loop blends to it once it's decoding
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

  update({ now }: Frame) {
    // Advance each slot's play clock; start it when the clip's first frame is ready. The
    // index holds at the last frame (clamped) once the clip plays out — like a paused-at-end
    // <video> — until the director swaps in a new clip.
    for (const s of this.slots) {
      if (!s.clip) continue
      if (s.startMs < 0) {
        if (s.clip.ready) s.startMs = now
        else continue
      }
      s.idx = Math.min(s.clip.total - 1, Math.floor(((now - s.startMs) / 1000) * FPS))
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
      const t = Math.min(1, (now - this.blendStart) / this.blendMs)
      const e = t * t * (3 - 2 * t)
      this.mix = t >= 1 ? this.mixTarget : this.mixFrom + (this.mixTarget - this.mixFrom) * e
    }
    // Fire onClipEnd once when the active clip reaches its last frame.
    if (this.pending < 0 && !this.endedFired) {
      const a = this.slots[this.active]
      if (a.clip && a.startMs >= 0 && a.idx >= a.clip.total - 1) {
        this.endedFired = true
        this.onClipEnd?.()
      }
    }
  }

  draw({ gl, view, proj, right, ambient }: Frame) {
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
    const mA = this.mouthAt(this.slots[0])
    const mB = this.mouthAt(this.slots[1])
    gl.uniform2fv(this.u.uMouthA, this.slots[0].poly)
    gl.uniform3fv(this.u.uSkinA, mA.skin)
    gl.uniform4fv(this.u.uBoxA, mA.box)
    gl.uniform1f(this.u.uHasA, mA.has)
    gl.uniform2fv(this.u.uMouthB, this.slots[1].poly)
    gl.uniform3fv(this.u.uSkinB, mB.skin)
    gl.uniform4fv(this.u.uBoxB, mB.box)
    gl.uniform1f(this.u.uHasB, mB.has)
    // Mouth erase reach (u-space; frame is 640px so 1.0 = 640px). Erase is solid out to
    // uMargin (~10px dilation), then feathers OUTWARD over uMouthFeather (~5px).
    gl.uniform1f(this.u.uMargin, 0.012)
    gl.uniform1f(this.u.uMouthFeather, 0.003)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose() {
    this.slots.forEach((s) => {
      s.clip?.close()
      this.gl.deleteTexture(s.tex)
    })
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.buf)
  }
}
