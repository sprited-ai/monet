import type { mat4, vec3 } from 'gl-matrix'

// What every node receives each frame to update + draw itself.
export type Frame = {
  gl: WebGL2RenderingContext
  now: number // ms (performance.now)
  dt: number // ms since last frame
  view: mat4
  proj: mat4
  right: vec3 // billboard right vector (upright)
  zoom: number // camera dolly zoom (the void scales with it)
  ambient: vec3 // room light tint (the HDRI / weather hook)
  width: number // drawing-buffer size (px)
  height: number
  toggles: Toggles
}

export type Toggles = {
  shadow: boolean
  vignette: boolean
  grain: boolean
}

// A scene-graph node. Drawn back-to-front in the order the Renderer holds them.
export interface SceneNode {
  update(frame: Frame): void
  draw(frame: Frame): void
  dispose(): void
}

// A clip's framing geometry (from contents/framings.json).
export type Framing = {
  frame: [number, number]
  origin?: [number, number]
  scale?: number
}

// A clip's per-frame pose data (from contents/monet/<clip>.pose.json). Coords are
// normalized 0..1 to the color frame. Only the bits the scene needs are typed here;
// com drives the contact-shadow x, face is the future camera zoom target.
export type Pose = {
  fps: number
  poses: ({ com: [number, number]; face: [number, number] } | null)[]
}
