import { createProgram, createQuad, createVideoTexture, uniforms } from '../gl-utils'
import spriteVert from '../shaders/sprite.vert?raw'
import spriteFrag from '../shaders/sprite.frag?raw'
import type { Frame, Framing, Mouth, Pose, SceneNode } from '../types'

// Monet's body: a billboarded stacked-alpha sprite (docs/008 + docs/016). Two
// <video> slots cross-dissolve in a single premultiplied draw — ported from the
// proven /preview Stage so the character never goes translucent at a clip seam.
// The director (Whiteroom) calls setClip(); this node knows nothing about the FSM.

const QUAD_H = 3.0 // world height of the reference billboard box — sets Monet's size
const QUAD: [number, number] = [QUAD_H, QUAD_H] // square; per-clip framing is resolved in the shader
// Feet baseline (= the proven /preview Stage value). The clip's feet anchor sits at
// ~0.87 of the frame, with the soles below it; 0.87 leaves that room so the whole
// foot renders down to the frame bottom instead of being clipped at the floor line.
const BASE: [number, number] = [0.5, 0.87]

type Slot = {
  video: HTMLVideoElement
  tex: WebGLTexture
  anc: [number, number] // feet anchor: x from left, y from top (normalized)
  scl: number // framing scale
  fas: number // frame aspect (frameW / frameH) — fallback if video dims unknown
  pose: Pose | null // this clip's per-frame pose (drives the contact shadow); may arrive late
  mouth: Mouth | null // this clip's per-frame mouth polygon (erased in the shader); may arrive late
  poly: Float32Array // scratch buffer (16 vec2) reused each frame to upload the mouth uniform
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
  private poseToken = [0, 0] // per-slot guard so a late pose fetch can't overwrite a newer clip
  pos: [number, number, number] = [0, 0, 0]
  onClipEnd: (() => void) | null = null

  constructor(private gl: WebGL2RenderingContext, container: HTMLElement) {
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
      'uMouthA', 'uMouthB', 'uSkinA', 'uSkinB', 'uBoxA', 'uBoxB', 'uHasA', 'uHasB', 'uMargin',
    ])
    const mkVideo = () => {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      v.setAttribute('muted', '')
      v.setAttribute('playsinline', '')
      // Safari won't decode a display:none video → keep it in the tree, tiny + clear.
      v.style.cssText = 'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none;top:0;left:0'
      container.appendChild(v)
      return v
    }
    this.slots = [0, 1].map(() => ({
      video: mkVideo(),
      tex: createVideoTexture(gl),
      anc: [0.5, 0.87] as [number, number],
      scl: 1,
      fas: 1,
      pose: null as Pose | null,
      mouth: null as Mouth | null,
      poly: new Float32Array(32),
    }))
  }

  private params(f: Framing): { anc: [number, number]; scl: number; fas: number } {
    const [fw, fh] = f.frame
    const anc: [number, number] = [(f.origin?.[0] ?? fw * 0.5) / fw, (f.origin?.[1] ?? fh * 0.87) / fh]
    return { anc, scl: f.scale ?? 1, fas: fw / fh }
  }

  // frame aspect read LIVE from the decoded video (frameW / color-half-height) so a
  // reused slot picks up its new clip's true shape; falls back to the framing value.
  private fas(s: Slot): number {
    const v = s.video
    return v.videoWidth && v.videoHeight ? v.videoWidth / (v.videoHeight / 2) : s.fas
  }

  // pose may be a Promise (the JSON fetch races the video load) — it's assigned to
  // the slot when it resolves, guarded so a later clip reusing the slot wins.
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
    const tok = ++this.poseToken[slot] // one guard for this clip's late pose + mouth fetches
    Promise.resolve(pose ?? null).then((pd) => {
      if (this.poseToken[slot] === tok) s.pose = pd
    })
    Promise.resolve(mouth ?? null).then((md) => {
      if (this.poseToken[slot] === tok) s.mouth = md
    })
    s.video.src = src
    s.video.load() // Safari won't refetch a reused (ended) element on a bare src swap
    s.video.play().catch(() => {})
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

  // World-x offset (along the billboard right vector) of the active clip's center of
  // mass for the current frame — i.e. where the contact shadow should sit relative to
  // the feet. null when this clip has no pose data. Derived by inverting the sprite
  // shader: u.x = anc.x + (v_uv.x-0.5)*quadAspect/(scl*fas), and world = (v_uv.x-0.5)*quad.x.
  groundOffset(): number | null {
    const s = this.slots[this.active]
    const pose = s.pose
    if (!pose || !pose.poses.length) return null
    const v = s.video
    if (!(v.duration > 0)) return null
    const n = pose.poses.length
    const idx = Math.max(0, Math.min(n - 1, Math.round(v.currentTime * (pose.fps || 24))))
    const fr = pose.poses[idx]
    if (!fr) return null
    return (fr.com[0] - s.anc[0]) * s.scl * this.fas(s) * QUAD[1]
  }

  // Per-slot mouth-erase uniforms for the current video time. Fills the slot's scratch
  // `poly` buffer (16 vec2, u-space) and returns skin/box/has; has=0 → shader leaves the
  // mouth untouched. Frame-indexed exactly like groundOffset (currentTime × fps).
  private mouthAt(s: Slot): { skin: [number, number, number]; box: [number, number, number, number]; has: number } {
    const md = s.mouth
    const v = s.video
    const off = { skin: [0, 0, 0] as [number, number, number], box: [0, 0, 0, 0] as [number, number, number, number], has: 0 }
    if (!md || !md.frames.length || !(v.duration > 0)) return off
    // floor, not round: the <video> holds frame floor(t*fps) across the whole frame
    // interval, so round() would lead the erased mouth up to one frame ahead.
    const idx = Math.max(0, Math.min(md.frames.length - 1, Math.floor(v.currentTime * (md.fps || 24))))
    const fr = md.frames[idx]
    if (!fr) return off
    const p = s.poly
    for (let i = 0; i < 16; i++) {
      p[i * 2] = fr.poly[i][0]
      p[i * 2 + 1] = fr.poly[i][1]
    }
    return { skin: [fr.skin[0] / 255, fr.skin[1] / 255, fr.skin[2] / 255], box: fr.box, has: 1 }
  }

  update({ now }: Frame) {
    // Start the transition once the incoming clip actually has a frame (readyState-
    // driven, not event-driven — 'playing' was unreliable and could freeze the loop).
    if (this.pending >= 0 && this.slots[this.pending].video.readyState >= 2) {
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
    // Poll for the active clip ending (Safari drops 'ended'/'playing'). Fire once.
    if (this.pending < 0 && !this.endedFired) {
      const av = this.slots[this.active].video
      if (av.ended || (av.duration > 0 && av.currentTime >= av.duration - 0.05)) {
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
    // Upload both video frames (slot 0 → tA, slot 1 → tB). A slot with no clip yet
    // keeps its 1×1 placeholder (alpha 0), contributing nothing to the mix.
    const upload = (unit: number, s: Slot) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, s.tex)
      if (s.video.readyState >= 2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, s.video)
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
    gl.uniform1f(this.u.uMargin, 0.006) // ~4px dilation at the 640px frame; analytic, so crisp under zoom
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose() {
    this.slots.forEach((s) => {
      s.video.pause()
      s.video.remove()
      this.gl.deleteTexture(s.tex)
    })
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.buf)
  }
}
