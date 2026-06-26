import { createProgram, uniforms } from '../gl-utils'
import fullscreenVert from '../shaders/fullscreen.vert?raw'
import postFrag from '../shaders/post.frag?raw'
import type { Frame, SceneNode } from '../types'

// Fullscreen post overlay drawn last: vignette (alpha-black corners) + film grain
// (additive). Both toggleable (debug). Proper read-the-frame post is an FBO pass,
// deferred (docs/016).
export class PostNode implements SceneNode {
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private u: Record<string, WebGLUniformLocation | null>

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, fullscreenVert, postFrag)
    this.vao = gl.createVertexArray()!
    this.u = uniforms(gl, this.prog, ['u_mode', 'u_time'])
  }

  update() {}

  draw({ gl, now, toggles }: Frame) {
    if (!toggles.vignette && !toggles.grain) return
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.enable(gl.BLEND)
    gl.uniform1f(this.u.u_time, now / 1000)
    if (toggles.vignette) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1i(this.u.u_mode, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    if (toggles.grain) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA) // toward per-pixel gray (bidirectional)
      gl.uniform1i(this.u.u_mode, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }

  dispose() {
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
  }
}
