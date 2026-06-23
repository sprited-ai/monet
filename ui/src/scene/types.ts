import type { mat4, vec3 } from 'gl-matrix'

// What every node receives each frame to update + draw itself.
export type Frame = {
  gl: WebGL2RenderingContext
  now: number // ms (performance.now)
  dt: number // ms since last frame
  view: mat4
  proj: mat4
  right: vec3 // billboard right vector (upright)
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
