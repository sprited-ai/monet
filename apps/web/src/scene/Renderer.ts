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

  zoom = 1 // current dolly zoom (1 = the framing above); eased toward zoomTarget
  private zoomTarget = 1
  private shadowOffset = 0 // eased world-x offset of the shadow under Monet's CoM (pose-driven)
  private nodes: SceneNode[]
  private raf = 0
  private last = 0
  private view = mat4.create()
  private proj = mat4.create()
  private right = vec3.fromValues(1, 0, 0)
  private ambient = vec3.fromValues(1, 1, 1) // soft white-room light; HDRI/weather drives this later
  private dpr = Math.min(window.devicePixelRatio || 1, 2)
  // Overlay mode (desktop being, apps/desktop): the room dissolves and only
  // Monet's silhouette is painted over a transparent canvas, so she can float on the user's
  // desktop. Additive — the default (no opts) is the unchanged white room. See the experiment README.
  readonly overlay: boolean
  // The whiteroom framing intentionally runs her feet past the bottom edge (a cozy crop where she
  // stands at the bottom of the frame). In the room that reads fine; in the overlay it clips her
  // soles. Lift the render up by this many CSS px so the soles clear the window's bottom edge and she
  // sits *on* it (grounded "standing on the screen edge" look, not floating). Overlay-only; tune live
  // via window.renderer.overlayLiftPx in dev.
  //
  // Measured against the default 620-tall window at zoom 1 (apps/desktop, MONET_H): the feet anchor
  // (BASE.y 0.87, world y 0) projects ~23 px below the bottom edge, and the lowest opaque sole pixel
  // (frame-v 0.892, world y −0.067) ~40 px below. 46 grounds the soles with ~6 px clearance, well
  // under the ~69 px of empty headroom above her bow (so the lift never clips her head). Per-clip
  // soles share the 0.87 anchor, so this holds across clips; re-tune if MONET_H changes.
  overlayLiftPx = 46

  constructor(
    private canvas: HTMLCanvasElement,
    videoContainer: HTMLElement,
    opts?: { overlay?: boolean },
  ) {
    this.overlay = opts?.overlay ?? false
    // Overlay needs an alpha-backed canvas (so the page shows through) and a preserved drawing
    // buffer so the shell can read Monet's alpha under the cursor for pixel-perfect click-through.
    const gl = canvas.getContext('webgl2', {
      alpha: this.overlay,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: this.overlay,
    })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    this.room = new RoomNode(gl)
    this.shadow = new ShadowNode(gl)
    this.character = new CharacterNode(gl, videoContainer)
    this.post = new PostNode(gl)
    // Overlay = just her. The backdrop, contact shadow, and vignette/grain post all paint the
    // "empty" pixels, which would tint the see-through desktop — so overlay draws the sprite alone.
    this.nodes = this.overlay ? [this.character] : [this.room, this.shadow, this.character, this.post]
    // Soften her silhouette edge so she feathers into the desktop instead of a hard cutout (overlay
    // only; tunable live via window.renderer.character.edgeFeather in dev).
    if (this.overlay) this.character.edgeFeather = 0.004
    this.resize()
  }

  // Alpha (0..1) of the last rendered frame under a client-space point — the shell's hit-test for
  // click-through. Only meaningful in overlay mode (preserveDrawingBuffer). gl reads bottom-left up.
  alphaAt(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect()
    const x = Math.round((clientX - rect.left) * this.dpr)
    const y = Math.round((rect.bottom - clientY) * this.dpr)
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return 0
    const px = new Uint8Array(4)
    const gl = this.gl
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return px[3] / 255
  }

  private resize() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  // Wheel zoom: multiply the dolly target, clamped, then eased in computeCamera.
  zoomBy(factor: number) {
    this.zoomTarget = Math.min(2.6, Math.max(0.25, this.zoomTarget * factor))
  }

  private computeCamera() {
    const aspect = this.canvas.width / this.canvas.height
    mat4.perspective(this.proj, (this.cam.fov * Math.PI) / 180, aspect, 0.1, 100)
    this.zoom += (this.zoomTarget - this.zoom) * 0.2 // ease toward the wheel target
    const target = vec3.fromValues(this.cam.target[0], this.cam.target[1], this.cam.target[2])
    const eye = vec3.fromValues(this.cam.eye[0], this.cam.eye[1], this.cam.eye[2])
    // Dolly: scale the eye's offset from the target by 1/zoom (zoom>1 = closer/bigger).
    vec3.subtract(eye, eye, target)
    vec3.scale(eye, eye, 1 / this.zoom)
    vec3.add(eye, eye, target)
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
      if (this.overlay) gl.clearColor(0, 0, 0, 0)
      else gl.clearColor(0.93, 0.945, 0.96, 1)
      gl.clear(gl.COLOR_BUFFER_BIT) // clears the whole canvas (ignores viewport) → bottom strip stays transparent
      // Overlay: shift the scene up so her feet clear the window's bottom edge (the lifted region's
      // bottom strip is left transparent; aspect is unchanged — it reads canvas size, not viewport).
      if (this.overlay && this.overlayLiftPx) {
        const lift = Math.round(this.overlayLiftPx * this.dpr)
        gl.viewport(0, lift, this.canvas.width, this.canvas.height)
      }
      gl.disable(gl.DEPTH_TEST) // painter's order for v0 (a single sprite); depth sort arrives with more entities
      const frame: Frame = {
        gl,
        now,
        dt,
        view: this.view,
        proj: this.proj,
        right: this.right,
        zoom: this.zoom,
        ambient: this.ambient,
        width: this.canvas.width,
        height: this.canvas.height,
        toggles: this.toggles,
      }
      for (const n of this.nodes) n.update(frame)
      // The contact shadow follows Monet's center of mass when the clip has pose data
      // (else recenters under the feet). Eased here — temporal smoothing in the loop —
      // so the blob glides instead of snapping per pose frame. Offset is along the
      // billboard right vector (≈ world x for a front-on camera).
      const off = this.character.groundOffset() ?? 0
      this.shadowOffset += (off - this.shadowOffset) * (1 - Math.exp(-dt / 90))
      this.shadow.pos[0] = this.character.pos[0] + this.right[0] * this.shadowOffset
      this.shadow.pos[2] = this.character.pos[2] + this.right[2] * this.shadowOffset
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
