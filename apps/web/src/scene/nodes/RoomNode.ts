import { createProgram, uniforms } from '../gl-utils'
import fullscreenVert from '../shaders/fullscreen.vert?raw'
import backdropFrag from '../shaders/backdrop.frag?raw'
import type { Frame, SceneNode } from '../types'

// The voice turn-state the backdrop tints itself with. Color is 0..1 rgb; level is the live
// loudness (0..1); active fades the whole aura in only while voice mode is on.
export type RoomMood = { color: [number, number, number]; level: number; active: number }

// The white room: a soft gradient void (docs/016). Fullscreen, opaque, drawn
// first. It scales with the camera zoom (u_scale) so the void responds to the
// wheel dolly instead of sitting static while only Monet changes. On top of the
// void it blooms a mood aura behind Monet (see backdrop.frag) — the conversation's
// ambient visualization, fed each frame by `moodSource` (set by the director).
export class RoomNode implements SceneNode {
  // The director (Whiteroom) points this at the live turn state; read every frame. Null → no aura.
  moodSource: (() => RoomMood) | null = null
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private u: Record<string, WebGLUniformLocation | null>
  // Eased so the aura glides between turns/levels instead of snapping per frame.
  private color: [number, number, number] = [0.83, 0.65, 0.36]
  private level = 0
  private active = 0

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, fullscreenVert, backdropFrag)
    this.vao = gl.createVertexArray()! // empty VAO for the gl_VertexID triangle
    this.u = uniforms(gl, this.prog, ['u_scale', 'u_time', 'u_moodColor', 'u_moodLevel', 'u_active'])
  }

  update({ dt }: Frame) {
    const m = this.moodSource?.() ?? { color: this.color, level: 0, active: 0 }
    // Time-constant easing (frame-rate independent): color + active glide slowly, level a touch
    // faster so the aura still feels responsive to the voice.
    const kSlow = 1 - Math.exp(-dt / 220)
    const kFast = 1 - Math.exp(-dt / 90)
    for (let i = 0; i < 3; i++) this.color[i] += (m.color[i] - this.color[i]) * kSlow
    this.active += (m.active - this.active) * kSlow
    this.level += (m.level - this.level) * kFast
  }

  draw({ gl, zoom, now }: Frame) {
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)
    gl.uniform1f(this.u.u_scale, zoom)
    gl.uniform1f(this.u.u_time, now * 0.001)
    gl.uniform3f(this.u.u_moodColor, this.color[0], this.color[1], this.color[2])
    gl.uniform1f(this.u.u_moodLevel, this.level)
    gl.uniform1f(this.u.u_active, this.active)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
  }
}
