import { useEffect, useRef, type CSSProperties } from 'react'
import { mat3, mat4, vec3 } from 'gl-matrix'
import { SAM_EDGES } from './Stage'

// box-man 3D skin (experiments/box-man) — render the SAM rig as REAL cuboids in 3D, with the
// SAME camera as the original clip so the boxes sit exactly where Monet is in the footage.
// The verified SAM projection is a plain pinhole: px = f*(X+tx)/(Z+tz)+W/2, py = f*(Y+ty)/
// (Z+tz)+H/2 (image Y is down). We replicate it in the vertex shader from the per-frame
// camera (cam_t, focal) shipped in <clip>.s3body3d.json. A cuboid per SAM_EDGES bone + a head
// cube, flat-lit per face. Lab-only: Preview swaps this in for skin='3d'.

export type Kp3dDoc = {
  clip: string
  fps: number
  frames: number
  W: number
  H: number
  kp3d: number[][][] // [frame][70][x,y,z] — model space, image Y is DOWN
  cam_t: number[][] // [frame][3] — camera translation added before projection
  focal: number[] // [frame] — focal length in px
  valid?: boolean[]
}

type Props = {
  data: Kp3dDoc | null
  fps?: number
  zoom?: number
  scrub?: number | null
  onFrame?: (frame: number, total: number) => void
  onReady?: () => void
  style?: CSSProperties
}

// Replicates the SAM pinhole in clip space (principal point = image centre, image Y down →
// flip for GL). w = camera-space Z, so the perspective divide reproduces px/py exactly.
const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
uniform mat4 uModel;
uniform mat3 uNormal;
uniform float uF;   // focal (px)
uniform float uW;
uniform float uH;
uniform vec3 uCamT;
out vec3 vN;
void main(){
  vN = uNormal * aNorm;
  vec3 pc = (uModel * vec4(aPos, 1.0)).xyz + uCamT;
  float near = 0.05, far = 60.0;
  float zc = (far + near) / (far - near) * pc.z - 2.0 * far * near / (far - near);
  gl_Position = vec4(2.0 * uF / uW * pc.x, -2.0 * uF / uH * pc.y, zc, pc.z);
}`

const FRAG = `#version 300 es
precision highp float;
in vec3 vN;
out vec4 o;
uniform vec3 uLight;
uniform vec3 uColor;
void main(){
  float d = max(dot(normalize(vN), normalize(uLight)), 0.0);
  float shade = 0.5 + 0.5 * d;
  o = vec4(uColor * shade, 1.0);
}`

// Unit cube centered at origin (side 1), per-face normals → crisp flat-shaded faces.
function cubeGeometry(): Float32Array {
  const faces: [number[], number[][]][] = [
    [[1, 0, 0], [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]]],
    [[-1, 0, 0], [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]]],
    [[0, 1, 0], [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]]],
    [[0, -1, 0], [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]]],
    [[0, 0, 1], [[.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [-.5, -.5, .5]]],
    [[0, 0, -1], [[-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [.5, -.5, -.5]]],
  ]
  const out: number[] = []
  for (const [n, quad] of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(quad[i][0], quad[i][1], quad[i][2], n[0], n[1], n[2])
  }
  return new Float32Array(out)
}

const isFinger = (i: number) => (i >= 21 && i <= 40) || (i >= 42 && i <= 61)
const HEAD_KP = [0, 1, 2, 3, 4]
const ARM_KP = new Set([7, 8, 41, 62]) // elbows + wrists → thinner boxes
const BOX_COLOR: [number, number, number] = [0.937, 0.894, 0.812] // warm cardboard

export default function BoxManStage({ data, fps = 24, zoom = 1, scrub = null, onFrame, onReady, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrubRef = useRef(scrub); scrubRef.current = scrub
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const fpsRef = useRef(fps); fpsRef.current = fps
  const onFrameRef = useRef(onFrame); onFrameRef.current = onFrame
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady
  const dataRef = useRef(data); dataRef.current = data

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true })
    if (!gl) return

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link')
    gl.useProgram(prog)
    const uModel = gl.getUniformLocation(prog, 'uModel')
    const uNormal = gl.getUniformLocation(prog, 'uNormal')
    const uF = gl.getUniformLocation(prog, 'uF')
    const uW = gl.getUniformLocation(prog, 'uW')
    const uH = gl.getUniformLocation(prog, 'uH')
    const uCamT = gl.getUniformLocation(prog, 'uCamT')
    const uLight = gl.getUniformLocation(prog, 'uLight')
    const uColor = gl.getUniformLocation(prog, 'uColor')

    const verts = cubeGeometry()
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12)
    const VCOUNT = verts.length / 6

    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE) // the y-flip in projection flips winding; boxes are opaque, so just draw both sides
    gl.uniform3f(uColor, BOX_COLOR[0], BOX_COLOR[1], BOX_COLOR[2])
    gl.uniform3f(uLight, 0.3, -0.7, -0.6) // image Y is down → -Y is up; light from upper-front

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize()

    const pt = (kp: number[][], i: number): vec3 | null => {
      const p = kp[i]
      return p ? vec3.fromValues(p[0], p[1], p[2]) : null // raw (image Y down) — matches the camera
    }

    const tmp = mat4.create()
    const nrm = mat3.create()
    const boneModel = (a: vec3, b: vec3, th: number) => {
      const dir = vec3.sub(vec3.create(), b, a)
      const len = vec3.length(dir)
      if (len < 1e-6) return null
      vec3.scale(dir, dir, 1 / len)
      const ref: vec3 = Math.abs(dir[1]) > 0.99 ? vec3.fromValues(0, 0, 1) : vec3.fromValues(0, 1, 0)
      const z = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), dir, ref))
      const y = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), z, dir))
      const mid = vec3.lerp(vec3.create(), a, b, 0.5)
      mat4.set(tmp,
        dir[0] * len, dir[1] * len, dir[2] * len, 0,
        y[0] * th, y[1] * th, y[2] * th, 0,
        z[0] * th, z[1] * th, z[2] * th, 0,
        mid[0], mid[1], mid[2], 1)
      return tmp
    }
    const drawBox = (m: mat4) => {
      gl.uniformMatrix4fv(uModel, false, m)
      mat3.normalFromMat4(nrm, m)
      gl.uniformMatrix3fv(uNormal, false, nrm)
      gl.drawArrays(gl.TRIANGLES, 0, VCOUNT)
    }
    const boxAt = (center: vec3, sx: number, sy: number, sz: number) => {
      mat4.identity(tmp)
      mat4.translate(tmp, tmp, center)
      mat4.scale(tmp, tmp, [sx, sy, sz])
      return tmp
    }

    // figure scale (shoulder span) → box thickness, from the first frame
    const k0 = data?.kp3d?.[0]
    let unit = 0.3
    if (k0) {
      const sL = pt(k0, 5), sR = pt(k0, 6)
      if (sL && sR) unit = Math.max(0.12, vec3.distance(sL, sR))
    }
    const limbTh = unit * 0.5
    const armTh = unit * 0.36

    let raf = 0
    const t0 = performance.now()
    onReadyRef.current?.()

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const d = dataRef.current
      const F = d?.kp3d?.length ?? 0
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      if (!F || !d) return
      const tnow = performance.now()
      const idx = scrubRef.current != null
        ? Math.max(0, Math.min(F - 1, Math.round(scrubRef.current)))
        : Math.floor(((tnow - t0) / 1000) * fpsRef.current) % F
      const kp = d.kp3d[idx]

      // square viewport, centered → the W×H (square) image isn't stretched (object-fit: contain)
      const cw = canvas.width, ch = canvas.height
      const s = Math.min(cw, ch)
      gl.viewport(Math.floor((cw - s) / 2), Math.floor((ch - s) / 2), s, s)

      // SAM camera for this frame (focal scaled by user zoom = dolly)
      const ct = d.cam_t[idx] ?? d.cam_t[0]
      gl.uniform1f(uF, (d.focal[idx] ?? d.focal[0]) * zoomRef.current)
      gl.uniform1f(uW, d.W)
      gl.uniform1f(uH, d.H)
      gl.uniform3f(uCamT, ct[0], ct[1], ct[2])

      for (let e = 0; e < SAM_EDGES.length; e++) {
        const [a, b] = SAM_EDGES[e]
        if (isFinger(a) || isFinger(b)) continue
        if (HEAD_KP.includes(a) && HEAD_KP.includes(b)) continue
        const A = pt(kp, a), B = pt(kp, b)
        if (!A || !B) continue
        const m = boneModel(A, B, ARM_KP.has(a) || ARM_KP.has(b) ? armTh : limbTh)
        if (m) drawBox(m)
      }

      const hp = HEAD_KP.map((i) => pt(kp, i)).filter(Boolean) as vec3[]
      if (hp.length) {
        const lo = vec3.clone(hp[0]); const hi = vec3.clone(hp[0])
        for (const p of hp) { vec3.min(lo, lo, p); vec3.max(hi, hi, p) }
        const c = vec3.lerp(vec3.create(), lo, hi, 0.5)
        const side = Math.max(unit * 0.95, vec3.distance(lo, hi) * 0.9)
        drawBox(boxAt(c, side, side, side))
      }

      onFrameRef.current?.(idx, F)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      gl.deleteProgram(prog)
      gl.deleteBuffer(vbo)
      gl.deleteVertexArray(vao)
    }
  }, [data])

  return (
    <div style={{ position: 'relative', ...style }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}
