import { mat4, vec3 } from 'gl-matrix'
import type { Frame, SceneNode, Toggles } from './types'
import { RoomNode } from './nodes/RoomNode'
import { ShadowNode } from './nodes/ShadowNode'
import { CharacterNode } from './nodes/CharacterNode'
import { PostNode } from './nodes/PostNode'

// The white room's renderer: a real 3D scene (perspective camera) drawn as a
// z-ordered scene graph — backdrop → shadow → billboarded sprite → post
// (docs/016). Plain TS (framework-agnostic); Whiteroom mounts it on a canvas.
export class Renderer {
  readonly gl: WebGL2RenderingContext
  readonly room: RoomNode
  readonly shadow: ShadowNode
  readonly character: CharacterNode
  readonly post: PostNode
  toggles: Toggles = { shadow: true, vignette: true, grain: true }
  // Cozy near-front camera (docs/016). Tunable live in the debug overlay.
  cam = { fov: 34, eye: [0, 1.45, 3.9] as [number, number, number], target: [0, 1.3, 0] as [number, number, number] }

  private nodes: SceneNode[]
  private raf = 0
  private last = 0
  private view = mat4.create()
  private proj = mat4.create()
  private right = vec3.fromValues(1, 0, 0)
  private ambient = vec3.fromValues(1, 1, 1) // soft white-room light; HDRI/weather drives this later
  private dpr = Math.min(window.devicePixelRatio || 1, 2)

  constructor(
    private canvas: HTMLCanvasElement,
    videoContainer: HTMLElement,
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    this.room = new RoomNode(gl)
    this.shadow = new ShadowNode(gl)
    this.character = new CharacterNode(gl, videoContainer)
    this.post = new PostNode(gl)
    this.nodes = [this.room, this.shadow, this.character, this.post]
    this.resize()
  }

  private resize() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  private computeCamera() {
    const aspect = this.canvas.width / this.canvas.height
    mat4.perspective(this.proj, (this.cam.fov * Math.PI) / 180, aspect, 0.1, 100)
    const eye = vec3.fromValues(this.cam.eye[0], this.cam.eye[1], this.cam.eye[2])
    const target = vec3.fromValues(this.cam.target[0], this.cam.target[1], this.cam.target[2])
    const up = vec3.fromValues(0, 1, 0)
    mat4.lookAt(this.view, eye, target, up)
    // Upright billboard right = the camera's right vector flattened onto the xz plane.
    const fwd = vec3.create()
    vec3.subtract(fwd, target, eye)
    vec3.normalize(fwd, fwd)
    vec3.cross(this.right, fwd, up)
    this.right[1] = 0
    vec3.normalize(this.right, this.right)
  }

  start() {
    const loop = (now: number) => {
      const dt = this.last ? now - this.last : 16
      this.last = now
      this.resize()
      this.computeCamera()
      const gl = this.gl
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      gl.clearColor(0.93, 0.945, 0.96, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.disable(gl.DEPTH_TEST) // painter's order for v0 (a single sprite); depth sort arrives with more entities
      const frame: Frame = {
        gl,
        now,
        dt,
        view: this.view,
        proj: this.proj,
        right: this.right,
        ambient: this.ambient,
        width: this.canvas.width,
        height: this.canvas.height,
        toggles: this.toggles,
      }
      for (const n of this.nodes) n.update(frame)
      for (const n of this.nodes) n.draw(frame)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }

  dispose() {
    this.stop()
    this.nodes.forEach((n) => n.dispose())
  }
}
