import { createProgram, uniforms } from '../gl-utils'
import fullscreenVert from '../shaders/fullscreen.vert?raw'
import backdropFrag from '../shaders/backdrop.frag?raw'
import type { Frame, SceneNode } from '../types'

// The white room: a soft gradient void (docs/016). Fullscreen, opaque, drawn
// first. It scales with the camera zoom (u_scale) so the void responds to the
// wheel dolly instead of sitting static while only Monet changes.
export class RoomNode implements SceneNode {
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private u: Record<string, WebGLUniformLocation | null>

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, fullscreenVert, backdropFrag)
    this.vao = gl.createVertexArray()! // empty VAO for the gl_VertexID triangle
    this.u = uniforms(gl, this.prog, ['u_scale'])
  }

  update() {}

  draw({ gl, zoom }: Frame) {
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)
    gl.uniform1f(this.u.u_scale, zoom)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
  }
}
