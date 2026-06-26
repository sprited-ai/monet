import { createProgram, createQuad, uniforms } from '../gl-utils'
import shadowVert from '../shaders/shadow.vert?raw'
import shadowFrag from '../shaders/shadow.frag?raw'
import type { Frame, SceneNode } from '../types'

// RO-style contact shadow: a soft blob on the floor under the character, projected
// by the real camera so it foreshortens. Toggleable (debug).
export class ShadowNode implements SceneNode {
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private buf: WebGLBuffer
  private u: Record<string, WebGLUniformLocation | null>
  pos: [number, number, number] = [0, 0, 0]
  size: [number, number] = [0.55, 0.2] // x radius, z radius (flat ellipse on the floor)

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, shadowVert, shadowFrag)
    this.buf = createQuad(gl, false)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.u = uniforms(gl, this.prog, ['u_view', 'u_proj', 'u_pos', 'u_size', 'u_strength'])
  }

  update() {}

  draw({ gl, view, proj, toggles }: Frame) {
    if (!toggles.shadow) return
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniformMatrix4fv(this.u.u_view, false, view)
    gl.uniformMatrix4fv(this.u.u_proj, false, proj)
    gl.uniform3fv(this.u.u_pos, this.pos)
    gl.uniform2fv(this.u.u_size, this.size)
    gl.uniform1f(this.u.u_strength, 1.0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose() {
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.buf)
  }
}
