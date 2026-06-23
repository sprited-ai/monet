import { createProgram } from '../gl-utils'
import fullscreenVert from '../shaders/fullscreen.vert?raw'
import backdropFrag from '../shaders/backdrop.frag?raw'
import type { Frame, SceneNode } from '../types'

// The white room: an empty gradient void (docs/016). Fullscreen, opaque, drawn
// first. Camera-independent — it's the light around her, not geometry.
export class RoomNode implements SceneNode {
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, fullscreenVert, backdropFrag)
    this.vao = gl.createVertexArray()! // empty VAO for the gl_VertexID triangle
  }

  update() {}

  draw({ gl }: Frame) {
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
  }
}
