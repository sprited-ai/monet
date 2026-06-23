// gl-utils.ts — shared WebGL2 plumbing (shader compile, program link, textures).
// Pure GL, no domain logic. Ported from ../machi/ui/src/utils/gl-utils.ts, with
// sprite textures forced to LINEAR so billboarded sprites stay smooth (docs/016).

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile error: ${log}\n${source}`)
  }
  return shader
}

export function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
  const program = gl.createProgram()
  if (!program) throw new Error('Failed to create program')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link error: ${log}`)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return program
}

/** Cache uniform locations for a program by name. */
export function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) {
  const map: Record<string, WebGLUniformLocation | null> = {}
  for (const n of names) map[n] = gl.getUniformLocation(program, n)
  return map
}

/** An empty texture, LINEAR + CLAMP — later fed per-frame from a <video> element. */
export function createVideoTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  // 1×1 placeholder so the sampler is complete before the first video frame.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

/** A static quad VBO. `unit` → [0,1]² (sprite frame), else [-1,1]² (floor shadow). */
export function createQuad(gl: WebGL2RenderingContext, unit: boolean): WebGLBuffer {
  const a = unit ? 0 : -1
  const b = 1
  const verts = unit
    ? new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])
    : new Float32Array([a, a, b, a, a, b, b, b])
  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)
  return buf
}
