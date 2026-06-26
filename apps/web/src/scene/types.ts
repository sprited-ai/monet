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

// A clip's per-frame pose data (from contents/monet/<clip>.bizarre.json). Coords are
// normalized 0..1 to the color frame. Only the bits the scene needs are typed here;
// com drives the contact-shadow x, face is the future camera zoom target.
export type Pose = {
  fps: number
  poses: ({ com: [number, number]; face: [number, number] } | null)[]
}

// A clip's per-frame mouth region (from contents/monet/<clip>.mouth.json), tracked
// by SAM3. Coords are normalized 0..1 to the color frame (= sprite shader u-space).
// `poly` is the raw 16-gon (dilation/feather are applied analytically in the shader),
// `skin` is the flat-fill colour (0..255), `box` the AABB for a shader early-out.
export type MouthFrame = {
  f: number
  poly: [number, number][] | null // null on frames before the SAM3 prompt lands (e.g. back-facing)
  skin: [number, number, number]
  box: [number, number, number, number]
}
export type Mouth = { clip: string; fps: number; n: number; frames: MouthFrame[] }

// A clip's per-frame face landmarks (from contents/monet/<clip>.face.json), 28-pt
// anime-face-detector. Coords normalized 0..1 to the color frame (= sprite u-space),
// so they share the mouth box's space. Only the mouth corners (kp 24 = left, 26 = right)
// are used — to tilt the rigged mouth with the head. `faces[i]` is null on frames with no
// frontal face (turn/jump), where the tilt falls back to 0.
export type FaceFrame = { bbox: [number, number, number, number]; score: number; kp: [number, number, number][] }
export type Face = { fps: number; faces: (FaceFrame | null)[] }
