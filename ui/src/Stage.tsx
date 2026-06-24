import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { Mouth } from './scene/types'

// Mouth debug mode: show the SAM3 polygon as a contour, flat-fill (erase) it, or off.
export type MouthMode = 'contour' | 'erase' | 'off'

// Monet's stage: a stacked-alpha player with a TWO-texture shader so clip
// transitions cross-dissolve *in the shader* (rgb AND alpha mixed) over a few
// frames — no CSS-opacity double-transparency, and the tone jump at the seam
// melts across the blend. The previous clip holds its last frame while the next
// fades in over it. See docs/008-video-rendering.md.

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}`
// Per-slot scale + anchor normalize the character's on-screen size across framings
// (a bigger frame = more zoomed-out → scale>1 magnifies it back). The anchor (feet)
// is the fixed point so Monet stays grounded while scaling. `zoom` is a global user
// multiplier. Sampling outside the frame is transparent (no edge smear).
const FS = `precision mediump float;varying vec2 uv;
uniform sampler2D tA;uniform sampler2D tB;uniform float mixv;uniform float fw;uniform float zoom;
uniform vec2 ancA;uniform float sclA;uniform vec2 ancB;uniform float sclB;uniform vec2 base;uniform float aspect;
uniform float fasA;uniform float fasB; // per-slot frame aspect (frameW/frameH)
// MOUTH ERASE ('erase' mode): the active clip's per-frame 16-gon (u-space) + skin.
// uHasMouth gates it; uMargin dilates+feathers analytically (crisp under zoom).
uniform vec2 uMouth[16];uniform vec3 uSkin;uniform vec4 uBox;uniform float uHasMouth;uniform float uMargin;
// Signed distance to the 16-gon (IQ). Prev-vertex tracked (vj) to avoid non-loop
// array indexing, which GLSL ES 1.00 (WebGL1) disallows.
float sdPoly(vec2 p, vec2 v[16]){
  float d=dot(p-v[0],p-v[0]); float s=1.0; vec2 vj=v[15];
  for(int i=0;i<16;i++){
    vec2 vi=v[i]; vec2 e=vj-vi; vec2 w=p-vi;
    vec2 b=w-e*clamp(dot(w,e)/dot(e,e),0.0,1.0);
    d=min(d,dot(b,b));
    bvec3 c=bvec3(p.y>=vi.y, p.y<vj.y, e.x*w.y>e.y*w.x);
    if(all(c)||all(not(c))) s=-s;
    vj=vi;
  }
  return s*sqrt(d);
}
// anc = where the feet are in THIS clip's frame (per framing). base = the fixed
// screen point the feet sit at, same for every clip. The canvas matches the
// viewport rect (not the square frame); aspect = canvasW/canvasH keeps texels
// square (no distortion) and lets a wide viewport show MORE of the frame's sides
// instead of cropping them. Vertical fit drives scale; horizontal just fills the
// extra width. Feet land on the same screen baseline regardless of framing.
vec4 stk(sampler2D t,vec2 anc,float scl,float fas){
  float k=scl*zoom;
  // Divide x by the clip's OWN frame aspect (frameW/frameH). aspect corrects for
  // the canvas shape; without /fas, a non-square frame (wide=1.74) gets squished in
  // x by frameH/frameW → character too thin. Square frames (fas=1) are unchanged.
  vec2 u=vec2(anc.x+(uv.x-0.5)*aspect/(k*fas), anc.y+(uv.y-base.y)/k);
  if(u.x<0.0||u.x>1.0||u.y<0.0||u.y>1.0) return vec4(0.0);
  vec3 rgb=texture2D(t,vec2(u.x,u.y*0.5)).rgb;
  if(uHasMouth>0.5 && u.x>uBox.x-uMargin && u.x<uBox.z+uMargin && u.y>uBox.y-uMargin && u.y<uBox.w+uMargin){
    float cover=1.0-smoothstep(uMargin-0.004,uMargin+0.004,sdPoly(u,uMouth));
    rgb=mix(rgb,uSkin,cover);
  }
  float a=texture2D(t,vec2(u.x,0.5+u.y*0.5)).r;
  // Feather on the VIDEO RECT (frame coords u), not the render box — content near
  // the clip's own frame border softens. A property of the video, so it follows
  // scale/zoom with the frame rather than the viewport.
  float e=smoothstep(0.0,fw,u.x)*smoothstep(0.0,fw,1.0-u.x)
        *smoothstep(0.0,fw,u.y)*smoothstep(0.0,fw,1.0-u.y);
  return vec4(rgb,a*e);
}
void main(){
  vec4 a=stk(tA,ancA,sclA,fasA), b=stk(tB,ancB,sclB,fasB);
  // Cross-dissolve in PREMULTIPLIED space: a transparent texel (a==0) carries
  // garbage rgb under it, so mixing straight-alpha drags i2's color toward that
  // garbage and only reaches alpha=mixv. Premultiplying makes a==0 contribute
  // nothing, so i2's true rgb fades in cleanly. Un-premultiply for the
  // straight-alpha buffer (premultipliedAlpha:false).
  vec4 m=mix(vec4(a.rgb*a.a,a.a), vec4(b.rgb*b.a,b.a), mixv);
  gl_FragColor = m.a>0.0001 ? vec4(m.rgb/m.a, m.a) : vec4(0.0);
}`

// Skeleton edges (indices into kp, in coco_keypoints_ext order: 0 nose … 15/16
// ankles, 21/22 toes). Used only to draw the overlay.
const POSE_EDGES: [number, number][] = [
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16], [15, 21], [16, 22], [0, 5], [0, 6],
]
// Compact label per bizarre keypoint (coco_keypoints_ext order).
const POSE_LABELS: string[] = [
  'nose', 'eyeL', 'eyeR', 'earL', 'earR', 'shL', 'shR', 'elbL', 'elbR', 'wrL', 'wrR',
  'hipL', 'hipR', 'knL', 'knR', 'ankL', 'ankR', 'noseRt', 'bodyUp', 'thbL', 'thbR',
  'toeL', 'toeR',
]

// Draw one frame's pose overlay. `project(ux,uy) -> [sx,sy]` inverts the Stage
// shader transform, mapping normalized color-frame coords to screen pixels.
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  fr: PoseFrame,
  project: (ux: number, uy: number) => [number, number],
  w: number,
  h: number,
) {
  const KP_MIN = 0.12, LINE_MIN = 0.1
  // skeleton
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(0,210,255,0.85)'
  for (const [a, b] of POSE_EDGES) {
    const pa = fr.kp[a], pb = fr.kp[b]
    if (!pa || !pb || pa[2] < LINE_MIN || pb[2] < LINE_MIN) continue
    const A = project(pa[0], pa[1]), B = project(pb[0], pb[1])
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke()
  }
  // keypoint dots
  ctx.fillStyle = 'rgba(255,64,64,0.95)'
  for (const kp of fr.kp) {
    if (!kp || kp[2] < KP_MIN) continue
    const P = project(kp[0], kp[1])
    ctx.beginPath(); ctx.arc(P[0], P[1], 3, 0, 7); ctx.fill()
  }
  // com — center of mass → contact-shadow x: green plumb line + dot
  const C = project(fr.com[0], fr.com[1])
  ctx.strokeStyle = 'rgba(64,230,100,0.7)'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(C[0], 0); ctx.lineTo(C[0], h); ctx.stroke()
  ctx.fillStyle = 'rgba(64,230,100,0.95)'
  ctx.beginPath(); ctx.arc(C[0], C[1], 4, 0, 7); ctx.fill()
  // face — camera zoom-to-face target: blue dot + framing box
  const F = project(fr.face[0], fr.face[1])
  const half = Math.abs(project(fr.face[0] + 0.22, fr.face[1])[0] - F[0])
  ctx.strokeStyle = 'rgba(70,150,255,0.9)'
  ctx.lineWidth = 2
  ctx.strokeRect(F[0] - half, F[1] - half, half * 2, half * 2)
  ctx.fillStyle = 'rgba(70,150,255,0.95)'
  ctx.beginPath(); ctx.arc(F[0], F[1], 3.5, 0, 7); ctx.fill()
  // labels (white text + dark halo), matching the SAM overlay
  ctx.font = '11px ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  const lbl = (t: string, x: number, y: number) => {
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'
    ctx.strokeText(t, x + 4, y)
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    ctx.fillText(t, x + 4, y)
  }
  for (let i = 0; i < fr.kp.length; i++) {
    const k = fr.kp[i]
    if (!k || k[2] < KP_MIN) continue
    const P = project(k[0], k[1])
    lbl(POSE_LABELS[i] ?? String(i), P[0], P[1])
  }
  lbl('com', C[0], C[1])
  lbl('face', F[0], F[1])
  void w
}

// Draw the SAM3 mouth polygon as a contour overlay (an "x-ray" for the mouth track) —
// the raw 16-gon, projected from u-space to screen with the same inverse-shader
// transform as the pose overlay. Lets us verify the tracking before trusting the erase.
function drawMouthContour(
  ctx: CanvasRenderingContext2D,
  poly: [number, number][] | null,
  project: (ux: number, uy: number) => [number, number],
) {
  if (!poly || poly.length < 2) return
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,70,170,0.95)'
  ctx.beginPath()
  poly.forEach(([ux, uy], i) => {
    const [sx, sy] = project(ux, uy)
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  })
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,70,170,0.95)'
  for (const [ux, uy] of poly) {
    const [sx, sy] = project(ux, uy)
    ctx.beginPath()
    ctx.arc(sx, sy, 2.5, 0, 7)
    ctx.fill()
  }
}

// Soft contact-shadow ellipse drawn BEHIND the character (a layer under the GL
// canvas). Centered under her feet at screen (footX, footY); footX tracks the
// smoothed CoM so it slides with her sway. radius scales with her on-screen size.
function drawShadow(ctx: CanvasRenderingContext2D, footX: number, footY: number, rx: number) {
  const ry = Math.max(3, rx * 0.2) // flat ellipse
  ctx.save()
  ctx.translate(footX, footY)
  ctx.scale(rx, ry)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  g.addColorStop(0, 'rgba(40,30,28,0.34)')
  g.addColorStop(0.6, 'rgba(40,30,28,0.15)')
  g.addColorStop(1, 'rgba(40,30,28,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, 7)
  ctx.fill()
  ctx.restore()
}

// SAM-3D-Body 70-keypoint skeleton (mhr70): 65 edges + per-edge colors, lifted from
// the model's own metadata. Indices into the 70-kp array. Drives the "x-ray A" overlay.
const SAM_EDGES: [number, number][] = [
  [13, 11], [11, 9], [14, 12], [12, 10], [9, 10], [5, 9], [6, 10], [5, 6], [5, 7], [6, 8],
  [7, 62], [8, 41], [1, 2], [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [13, 15], [13, 16],
  [13, 17], [14, 18], [14, 19], [14, 20], [62, 45], [45, 44], [44, 43], [43, 42], [62, 49],
  [49, 48], [48, 47], [47, 46], [62, 53], [53, 52], [52, 51], [51, 50], [62, 57], [57, 56],
  [56, 55], [55, 54], [62, 61], [61, 60], [60, 59], [59, 58], [41, 24], [24, 23], [23, 22],
  [22, 21], [41, 28], [28, 27], [27, 26], [26, 25], [41, 32], [32, 31], [31, 30], [30, 29],
  [41, 36], [36, 35], [35, 34], [34, 33], [41, 40], [40, 39], [39, 38], [38, 37],
]
const SAM_COLORS: string[] = [
  '#00ff00', '#00ff00', '#ff8000', '#ff8000', '#3399ff', '#3399ff', '#3399ff', '#3399ff', '#00ff00',
  '#ff8000', '#00ff00', '#ff8000', '#3399ff', '#3399ff', '#3399ff', '#3399ff', '#3399ff', '#3399ff',
  '#3399ff', '#00ff00', '#00ff00', '#00ff00', '#ff8000', '#ff8000', '#ff8000', '#ff8000', '#ff8000',
  '#ff8000', '#ff8000', '#ff99ff', '#ff99ff', '#ff99ff', '#ff99ff', '#66b2ff', '#66b2ff', '#66b2ff',
  '#66b2ff', '#ff3333', '#ff3333', '#ff3333', '#ff3333', '#00ff00', '#00ff00', '#00ff00', '#00ff00',
  '#ff8000', '#ff8000', '#ff8000', '#ff8000', '#ff99ff', '#ff99ff', '#ff99ff', '#ff99ff', '#66b2ff',
  '#66b2ff', '#66b2ff', '#66b2ff', '#ff3333', '#ff3333', '#ff3333', '#ff3333', '#00ff00', '#00ff00',
  '#00ff00', '#00ff00',
]

// Compact label per keypoint (index order). Body parts spelled short; finger joints
// are <side><finger><joint>: R/L · t·i·m·r·p (thumb/index/middle/ring/pinky) · 4=tip…1=base.
const SAM_LABELS: string[] = [
  'nose', 'eyeL', 'eyeR', 'earL', 'earR', 'shL', 'shR', 'elbL', 'elbR', 'hipL', 'hipR',
  'knL', 'knR', 'ankL', 'ankR', 'toeLb', 'toeLs', 'heelL', 'toeRb', 'toeRs', 'heelR',
  'Rt4', 'Rt3', 'Rt2', 'Rt1', 'Ri4', 'Ri3', 'Ri2', 'Ri1', 'Rm4', 'Rm3', 'Rm2', 'Rm1',
  'Rr4', 'Rr3', 'Rr2', 'Rr1', 'Rp4', 'Rp3', 'Rp2', 'Rp1', 'wrR',
  'Lt4', 'Lt3', 'Lt2', 'Lt1', 'Li4', 'Li3', 'Li2', 'Li1', 'Lm4', 'Lm3', 'Lm2', 'Lm1',
  'Lr4', 'Lr3', 'Lr2', 'Lr1', 'Lp4', 'Lp3', 'Lp2', 'Lp1', 'wrL',
  'olcL', 'olcR', 'cubL', 'cubR', 'acrL', 'acrR', 'neck',
]

// Draw the SAM-3D-Body rig: 65 colored bones + keypoint dots + name labels.
// `kp` = 70 normalized [x,y]. Label index→name map: experiments/sam3d-body/README.
function drawSamOverlay(
  ctx: CanvasRenderingContext2D,
  kp: [number, number][],
  project: (ux: number, uy: number) => [number, number],
  labels = true,
) {
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  for (let e = 0; e < SAM_EDGES.length; e++) {
    const [a, b] = SAM_EDGES[e]
    const pa = kp[a], pb = kp[b]
    if (!pa || !pb) continue
    const A = project(pa[0], pa[1]), B = project(pb[0], pb[1])
    ctx.strokeStyle = SAM_COLORS[e] ?? '#60f'
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (const p of kp) {
    const P = project(p[0], p[1])
    ctx.beginPath(); ctx.arc(P[0], P[1], 2.6, 0, 7); ctx.fill()
  }
  if (labels) {
    ctx.font = '11px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    for (let i = 0; i < kp.length; i++) {
      // Skip the finger-joint labels (21–40 right, 42–61 left) — too dense; the
      // dots/bones still show the hands. Wrists (41/62) keep their label.
      if ((i >= 21 && i <= 40) || (i >= 42 && i <= 61)) continue
      const P = project(kp[i][0], kp[i][1])
      const t = SAM_LABELS[i] ?? String(i)
      ctx.strokeStyle = 'rgba(0,0,0,0.7)' // halo so the text reads on any background
      ctx.strokeText(t, P[0] + 4, P[1])
      ctx.fillStyle = 'rgba(255,255,255,0.96)'
      ctx.fillText(t, P[0] + 4, P[1])
    }
  }
}

// anime-face-detector 28-point landmark rig (one clip's <clip>.face.json). The
// index map (derived empirically on the Monet sprite — upstream doesn't publish it,
// labelled in image space) → grouped polylines so the face reads as a face:
//   0-4 contour · 5-7/8-10 eyebrows · 11-16/17-22 eyes · 23 nose · 24-27 mouth
const FACE_GROUPS: { name: string; edges: [number, number][]; color: string; lblAt: number }[] = [
  { name: 'jaw', color: '#ffffff', lblAt: 2, edges: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { name: 'browL', color: '#ffb14e', lblAt: 6, edges: [[5, 6], [6, 7]] },
  { name: 'browR', color: '#ffb14e', lblAt: 9, edges: [[8, 9], [9, 10]] },
  // eyes: top lid (a-b-c) + bottom lid (d-e-f), closed at the corners → almond
  { name: 'eyeL', color: '#35e0ff', lblAt: 12, edges: [[11, 12], [12, 13], [13, 16], [16, 15], [15, 14], [14, 11]] },
  { name: 'eyeR', color: '#35e0ff', lblAt: 18, edges: [[17, 18], [18, 19], [19, 22], [22, 21], [21, 20], [20, 17]] },
  { name: 'mouth', color: '#ff46aa', lblAt: 25, edges: [[24, 25], [25, 26], [26, 27], [27, 24]] },
]

// Draw the anime-face rig: grouped colored edges + keypoint dots + the nose marker +
// a short label per group. `kp` = 28 normalized [x,y,conf]; points below `KP_MIN`
// confidence are dimmed (drawn orange) but still plotted.
function drawFaceOverlay(
  ctx: CanvasRenderingContext2D,
  kp: [number, number, number][],
  project: (ux: number, uy: number) => [number, number],
  labels = true,
) {
  const KP_MIN = 0.2
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const g of FACE_GROUPS) {
    ctx.strokeStyle = g.color
    for (const [a, b] of g.edges) {
      const pa = kp[a], pb = kp[b]
      if (!pa || !pb) continue
      const A = project(pa[0], pa[1]), B = project(pb[0], pb[1])
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke()
    }
  }
  // keypoint dots — low confidence drawn orange, like the bizarre overlay
  for (let i = 0; i < kp.length; i++) {
    const k = kp[i]
    if (!k) continue
    const P = project(k[0], k[1])
    ctx.fillStyle = k[2] < KP_MIN ? 'rgba(255,165,0,0.95)' : 'rgba(255,255,255,0.92)'
    ctx.beginPath(); ctx.arc(P[0], P[1], 2.6, 0, 7); ctx.fill()
  }
  // nose (idx 23): a small yellow ring so it doesn't read as just another dot
  if (kp[23]) {
    const N = project(kp[23][0], kp[23][1])
    ctx.strokeStyle = '#ffe14e'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(N[0], N[1], 4, 0, 7); ctx.stroke()
  }
  if (labels) {
    ctx.font = '11px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    const lbl = (t: string, x: number, y: number) => {
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(t, x + 4, y)
      ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fillText(t, x + 4, y)
    }
    for (const g of FACE_GROUPS) {
      const k = kp[g.lblAt]
      if (!k) continue
      const P = project(k[0], k[1])
      lbl(g.name, P[0], P[1])
    }
    if (kp[23]) { const N = project(kp[23][0], kp[23][1]); lbl('nose', N[0], N[1]) }
  }
}

// Safari won't decode a display:none / visibility:hidden video, so a canvas fed by
// it stays blank. Keep the source element in the render tree but tiny + transparent.
const HIDDEN_VIDEO: CSSProperties = {
  position: 'absolute',
  width: 2,
  height: 2,
  opacity: 0,
  pointerEvents: 'none',
  top: 0,
  left: 0,
}

// Pose-overlay data (one clip's bizarre-pose-estimator output). Coords are
// normalized 0..1 to the COLOR frame — i.e. the shader's `u` space — so they map
// to screen by inverting the shader transform (see drawOverlay below).
export type PoseDoc = {
  fps: number
  frames: number
  poses: (PoseFrame | null)[]
}
type PoseFrame = {
  bbox: [number, number, number, number]
  com: [number, number]
  face: [number, number]
  kp: [number, number, number][] // [x, y, score]
}

// SAM-3D-Body rig (one clip's <clip>.s3body.json): 70 keypoints/frame, normalized
// 0..1 to the color frame. Body + feet + face + full hands (5 fingers × 4 joints).
export type SamDoc = {
  fps: number
  frames: number
  kp: ([number, number][] | null)[] // per frame: 70 [x,y] (or null on a failed frame)
}

// anime-face-detector rig (one clip's <clip>.face.json): 28 landmarks/frame,
// normalized 0..1 to the color frame. Per frame is the single highest-score face,
// or null on a frame with no detection. See experiments/anime-face-detector.
export type FaceDoc = {
  fps: number
  frames: number
  faces: ({ bbox: [number, number, number, number]; score: number; kp: [number, number, number][] } | null)[]
}

type Props = {
  src: string
  seq?: number // bumps every advance — re-runs the load effect even if src repeats
  scale?: number // framing render scale (regular = 1; large ≈ 1.3, etc.)
  anchor?: [number, number] // framing origin (feet) in the frame, normalized
  baseline?: [number, number] // fixed screen point the feet sit at, all clips
  zoom?: number // global user zoom multiplier
  pose?: PoseDoc | null // this clip's pose data, for the optional overlay
  s3body?: SamDoc | null // this clip's SAM-3D-Body 70-kp rig (contents/<clip>.s3body.json)
  face?: FaceDoc | null // this clip's anime-face-detector 28-kp rig (contents/<clip>.face.json)
  mouth?: Mouth | null // this clip's SAM3 mouth track (contents/<clip>.mouth.json)
  mouthMode?: MouthMode // 'contour' = polygon overlay, 'erase' = shader flat-fill, 'off' = neither
  showOverlay?: boolean // draw the x-ray overlay
  overlaySource?: 'bizarre' | 'sam' // x-ray B = bizarre (com/face/kp), x-ray A = SAM rig
  showFace?: boolean // draw the anime-face-detector 28-kp rig (its own overlay, on by default)
  showShadow?: boolean // draw a soft contact shadow under her feet (tracks com x)
  fps?: number // clip fps, for the frame scrubber (default 24)
  scrub?: number | null // pin to this frame (pauses); null = autoplay
  onFrame?: (frame: number, total: number) => void // emitted each draw for the scrubber
  onClipEnd?: () => void
  onPlaying?: () => void // fired once when playback actually starts (hide the poster)
  blendMs?: number
  feather?: number
  // Test hook: instead of playing, seek to this time (s) and hold the frame, so a
  // screenshot of the WebGL render is deterministic (no frame-timing flake). The
  // canvas gets data-ready="1" once the seeked frame is decoded AND drawn.
  freezeAt?: number
  style?: CSSProperties
}

export default function Stage({
  src,
  seq = 0,
  scale = 1,
  anchor = [0.5, 0.87],
  baseline = [0.5, 0.87],
  zoom = 1,
  pose = null,
  s3body = null,
  face = null,
  mouth = null,
  mouthMode = 'off',
  showOverlay = false,
  overlaySource = 'bizarre',
  showFace = false,
  showShadow = false,
  fps = 24,
  scrub = null,
  onFrame,
  onClipEnd,
  onPlaying,
  blendMs = 150,
  feather = 0.04,
  freezeAt,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const shadowRef = useRef<HTMLCanvasElement>(null)
  const vRef = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  const active = useRef(0) // slot currently playing / shown (0 or 1)
  const mixVal = useRef(0) // 0 = slot0, 1 = slot1 (what the shader shows)
  const mixTarget = useRef(0)
  const mixFrom = useRef(0)
  const blendStart = useRef(0)
  const pending = useRef(-1) // slot a new clip is loading into (start blend when ready)
  const endedFired = useRef(false) // guard: fire onClipEnd once per clip (poll-based)
  const first = useRef(true)
  const playingFired = useRef(false) // fire onPlaying once, when the first frame shows
  const frozenSeeked = useRef(false) // test freeze: the seek to freezeAt has landed
  const slotScale = useRef<[number, number]>([scale, scale]) // per-slot framing scale
  const slotAnchor = useRef<[[number, number], [number, number]]>([anchor, anchor])
  const slotPose = useRef<[PoseDoc | null, PoseDoc | null]>([pose, pose]) // per-slot pose
  const poseRef = useRef(pose) // latest pose prop, assigned to a slot on load
  poseRef.current = pose
  const slotMouth = useRef<[Mouth | null, Mouth | null]>([mouth, mouth]) // per-slot mouth track
  const mouthRef = useRef(mouth) // latest mouth prop, assigned to a slot on load
  mouthRef.current = mouth
  const slotS3body = useRef<[SamDoc | null, SamDoc | null]>([s3body, s3body]) // per-slot SAM rig
  const s3bodyRef = useRef(s3body) // latest s3body prop, assigned to a slot on load
  s3bodyRef.current = s3body
  const slotFace = useRef<[FaceDoc | null, FaceDoc | null]>([face, face]) // per-slot face rig
  const faceRef = useRef(face) // latest face prop, assigned to a slot on load
  faceRef.current = face
  const polyBuf = useRef(new Float32Array(32)) // scratch: 16 vec2 uploaded for shader erase
  const lastLoaded = useRef(0) // slot the most recent clip loaded into (pose fetch lands here)
  // Temporal smoothing state for the com/face markers (dt-based EMA in the draw loop).
  const smooth = useRef<{ com: [number, number]; face: [number, number]; idx: number; slot: number; t: number } | null>(null)
  const cur = useRef({ scale, anchor, baseline, zoom, showOverlay, overlaySource, showFace, showShadow, mouthMode, fps }) // latest props for the loop
  cur.current = { scale, anchor, baseline, zoom, showOverlay, overlaySource, showFace, showShadow, mouthMode, fps }
  const onEnd = useRef(onClipEnd)
  onEnd.current = onClipEnd
  const onPlay = useRef(onPlaying)
  onPlay.current = onPlaying
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const scrubRef = useRef(scrub) // null = autoplay; a number pins/pauses to that frame
  scrubRef.current = scrub

  // GL setup + draw loop (two video textures, mixed by `mixv`).
  useEffect(() => {
    const cv = canvasRef.current!
    const a = vRef[0].current!
    const b = vRef[1].current!
    a.muted = true // imperative — React's `muted` attr doesn't reliably set the property
    b.muted = true
    // Lock overlays to the frame the compositor is ACTUALLY showing, not the one we
    // requested. Setting video.currentTime updates instantly, but the <video> paints
    // the seeked frame tens of ms later — so an overlay indexed by currentTime leads the
    // picture by 1–4 frames while scrubbing. requestVideoFrameCallback's mediaTime is the
    // presented frame's timestamp; index overlays by THAT and the rig can't drift from
    // the clip. (During playback mediaTime≈currentTime, so this is a no-op there.)
    const presented: [number, number] = [0, 0]
    const hasRVFC = 'requestVideoFrameCallback' in a
    const regVFC = (v: HTMLVideoElement, slot: 0 | 1) => {
      if (!hasRVFC) return
      const cb = (_now: number, meta: VideoFrameCallbackMetadata) => {
        presented[slot] = meta.mediaTime
        v.requestVideoFrameCallback(cb)
      }
      v.requestVideoFrameCallback(cb)
    }
    regVFC(a, 0)
    regVFC(b, 1)
    // preserveDrawingBuffer only in freeze/test mode: a full-page screenshot may
    // capture after the buffer is composited+cleared, blanking the canvas. Keeping
    // the buffer makes the frozen frame survive any capture path. Off in normal use
    // (lets the compositor drop the buffer each frame).
    const gl = cv.getContext('webgl', {
      premultipliedAlpha: false,
      alpha: true,
      preserveDrawingBuffer: freezeAt != null,
    })
    if (!gl) return
    const sh = (t: number, s: string) => {
      const o = gl.createShader(t)!
      gl.shaderSource(o, s)
      gl.compileShader(o)
      return o
    }
    const pr = gl.createProgram()!
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(pr)
    gl.useProgram(pr)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const lp = gl.getAttribLocation(pr, 'p')
    gl.enableVertexAttribArray(lp)
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0)
    const mkTex = () => {
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      // 1×1 placeholder so the texture is COMPLETE before a video frame arrives —
      // Safari renders the whole draw black if a bound sampler is incomplete (the
      // 2nd slot has no clip yet on the first play). Chrome tolerates it.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]))
      return t
    }
    gl.activeTexture(gl.TEXTURE0)
    const texA = mkTex()
    gl.activeTexture(gl.TEXTURE1)
    const texB = mkTex()
    gl.uniform1i(gl.getUniformLocation(pr, 'tA'), 0)
    gl.uniform1i(gl.getUniformLocation(pr, 'tB'), 1)
    gl.uniform1f(gl.getUniformLocation(pr, 'fw'), Math.max(0.0001, feather))
    const mixLoc = gl.getUniformLocation(pr, 'mixv')
    const zoomLoc = gl.getUniformLocation(pr, 'zoom')
    const ancALoc = gl.getUniformLocation(pr, 'ancA')
    const sclALoc = gl.getUniformLocation(pr, 'sclA')
    const ancBLoc = gl.getUniformLocation(pr, 'ancB')
    const sclBLoc = gl.getUniformLocation(pr, 'sclB')
    const baseLoc = gl.getUniformLocation(pr, 'base')
    const aspectLoc = gl.getUniformLocation(pr, 'aspect')
    const fasALoc = gl.getUniformLocation(pr, 'fasA')
    const fasBLoc = gl.getUniformLocation(pr, 'fasB')
    const uMouthLoc = gl.getUniformLocation(pr, 'uMouth')
    const uSkinLoc = gl.getUniformLocation(pr, 'uSkin')
    const uBoxLoc = gl.getUniformLocation(pr, 'uBox')
    const uHasMouthLoc = gl.getUniformLocation(pr, 'uHasMouth')
    const uMarginLoc = gl.getUniformLocation(pr, 'uMargin')
    gl.disable(gl.BLEND) // single quad written straight; browser composites the canvas

    // 2D overlay context (pose / com / face) + shadow context (behind the sprite),
    // both sized in lockstep with the GL canvas.
    const oc = overlayRef.current!
    const octx = oc.getContext('2d')
    const sc = shadowRef.current!
    const sctx = sc.getContext('2d')

    // Size the backing buffer to the DISPLAY rect (not the clip's 640² frame), so a
    // wide viewport renders wide and shows the frame's sides instead of cropping to a
    // square. dpr-aware for crispness; `aspect` feeds the shader.
    let aspect = 1
    let cssW = 1, cssH = 1, dpr = 1
    const sizeCanvas = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      cssW = cv.clientWidth
      cssH = cv.clientHeight
      const w = Math.max(1, Math.round(cssW * dpr))
      const h = Math.max(1, Math.round(cssH * dpr))
      if (cv.width !== w || cv.height !== h) {
        cv.width = w
        cv.height = h
      }
      if (oc.width !== w || oc.height !== h) {
        oc.width = w
        oc.height = h
      }
      if (sc.width !== w || sc.height !== h) {
        sc.width = w
        sc.height = h
      }
      aspect = w / h
    }
    sizeCanvas()
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(cv)
    window.addEventListener('resize', sizeCanvas)

    let raf = 0
    const draw = (now: number) => {
      // Start a pending transition once the incoming clip actually has a frame
      // (readyState-driven, not event-driven — 'playing' was unreliable and could
      // leave `active` stale, which dropped the next clip's onClipEnd and froze).
      if (pending.current >= 0) {
        const pv = vRef[pending.current].current
        if (pv && pv.readyState >= 2) {
          mixFrom.current = mixVal.current
          mixTarget.current = pending.current
          blendStart.current = now
          active.current = pending.current
          pending.current = -1
          endedFired.current = false // new clip is now active — allow its end to fire
        }
      }
      // Poll for the active clip ending (Safari drops 'ended'/'playing' events
      // intermittently → the loop would freeze). Fire onClipEnd once per clip.
      if (pending.current < 0 && !endedFired.current && scrubRef.current == null) {
        const av = active.current === 0 ? a : b
        if (av.ended || (av.duration > 0 && av.currentTime >= av.duration - 0.05)) {
          endedFired.current = true
          onEnd.current?.()
        }
      }
      // ease the blend toward its target
      if (mixVal.current !== mixTarget.current) {
        const t = Math.min(1, (now - blendStart.current) / blendMs)
        const e = t * t * (3 - 2 * t)
        mixVal.current = t >= 1 ? mixTarget.current : mixFrom.current + (mixTarget.current - mixFrom.current) * e
      }
      if (a.readyState >= 2) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texA)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, a)
      }
      if (b.readyState >= 2) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, texB)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, b)
      }
      gl.viewport(0, 0, cv.width, cv.height)
      gl.uniform1f(mixLoc, mixVal.current)
      gl.uniform1f(zoomLoc, cur.current.zoom)
      gl.uniform2fv(baseLoc, cur.current.baseline)
      gl.uniform1f(aspectLoc, aspect)
      // per-slot frame aspect (frameW / color-frameH); color is the top half, so /2.
      // Read live from the video so a reused slot picks up its new clip's shape.
      const fa = (v: HTMLVideoElement) => (v.videoWidth && v.videoHeight ? v.videoWidth / (v.videoHeight / 2) : 1)
      gl.uniform1f(fasALoc, fa(a))
      gl.uniform1f(fasBLoc, fa(b))
      gl.uniform2fv(ancALoc, slotAnchor.current[0])
      gl.uniform1f(sclALoc, slotScale.current[0])
      gl.uniform2fv(ancBLoc, slotAnchor.current[1])
      gl.uniform1f(sclBLoc, slotScale.current[1])
      // Display time = the frame actually on screen (rVFC mediaTime), not the requested
      // one (currentTime). Overlays + erase index by this so they stay locked to the
      // picture mid-scrub. Falls back to currentTime before the first frame paints / if
      // rVFC is unsupported.
      const dispT = (slot: number, v: HTMLVideoElement) => (hasRVFC ? presented[slot] || v.currentTime : v.currentTime)
      // Mouth erase ('erase' mode): upload the active clip's current-frame 16-gon + skin.
      const eslot = active.current
      const eav = eslot === 0 ? a : b
      const edoc = slotMouth.current[eslot]
      let hasMouth = 0
      if (cur.current.mouthMode === 'erase' && edoc && edoc.frames.length && eav.duration > 0) {
        const ei = Math.max(0, Math.min(edoc.frames.length - 1, Math.floor(dispT(eslot, eav) * (edoc.fps || 24))))
        const ef = edoc.frames[ei]
        if (ef?.poly) {
          const pb = polyBuf.current
          for (let i = 0; i < 16; i++) {
            pb[i * 2] = ef.poly[i][0]
            pb[i * 2 + 1] = ef.poly[i][1]
          }
          gl.uniform2fv(uMouthLoc, pb)
          gl.uniform3f(uSkinLoc, ef.skin[0] / 255, ef.skin[1] / 255, ef.skin[2] / 255)
          gl.uniform4f(uBoxLoc, ef.box[0], ef.box[1], ef.box[2], ef.box[3])
          hasMouth = 1
        }
      }
      gl.uniform1f(uHasMouthLoc, hasMouth)
      gl.uniform1f(uMarginLoc, 0.006)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // Resolve the active slot's current pose frame + smoothed com/face ONCE; the
      // shadow (behind the sprite) and the x-ray overlay (on top) both read it. The
      // transform inverts the sprite shader so normalized frame coords → screen px.
      const slot = active.current
      const av = slot === 0 ? a : b
      // Frame scrubber readout: emit the displayed frame (floor) + total each draw.
      if (onFrameRef.current && av.duration > 0) {
        const fpsNow = cur.current.fps || 24
        const total = Math.max(1, Math.round(av.duration * fpsNow))
        onFrameRef.current(Math.min(total - 1, Math.floor(av.currentTime * fpsNow)), total)
      }
      const doc = slotPose.current[slot]
      const anc = slotAnchor.current[slot]
      const kk = slotScale.current[slot] * cur.current.zoom
      const fas = fa(av)
      const base = cur.current.baseline
      const project = (ux: number, uy: number): [number, number] => [
        (0.5 + ((ux - anc[0]) * (kk * fas)) / aspect) * cssW,
        (base[1] + (uy - anc[1]) * kk) * cssH,
      ]
      let fr: PoseFrame | null = null
      if (doc && doc.poses.length && av.duration > 0) {
        const n = doc.poses.length
        const idx = Math.max(0, Math.min(n - 1, Math.floor(dispT(slot, av) * (doc.fps || 24))))
        const raw = doc.poses[idx]
        if (raw) {
          // Temporal smoothing (dt-based EMA, tau≈90ms): glides com/face, killing
          // jitter + the 24→60fps stair-step. Reset on clip change / loop wrap / seek.
          const s = smooth.current
          if (!s || s.slot !== slot || idx < s.idx || idx - s.idx > 4) {
            smooth.current = { com: [...raw.com], face: [...raw.face], idx, slot, t: now }
          } else {
            const aa = 1 - Math.exp(-Math.max(0, (now - s.t) / 1000) / 0.09)
            s.com[0] += (raw.com[0] - s.com[0]) * aa
            s.com[1] += (raw.com[1] - s.com[1]) * aa
            s.face[0] += (raw.face[0] - s.face[0]) * aa
            s.face[1] += (raw.face[1] - s.face[1]) * aa
            s.idx = idx
            s.t = now
          }
          fr = { ...raw, com: smooth.current!.com, face: smooth.current!.face }
        }
      }

      // Contact shadow — drawn BEHIND the sprite. footX tracks the CoM (feet anchor if
      // no pose); footY = the feet baseline; radius from the bbox width (else default).
      if (sctx) {
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        sctx.clearRect(0, 0, cssW, cssH)
        if (cur.current.showShadow && av.duration > 0) {
          const [footX, footY] = project(fr ? fr.com[0] : anc[0], anc[1])
          let rx = cssW * 0.13
          if (fr) {
            const x0 = project(fr.bbox[0], anc[1])[0]
            const x1 = project(fr.bbox[0] + fr.bbox[2], anc[1])[0]
            rx = Math.abs(x1 - x0) * 0.42
          }
          drawShadow(sctx, footX, footY, rx)
        }
      }

      // X-ray overlay — drawn ON TOP.
      if (octx) {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0)
        octx.clearRect(0, 0, cssW, cssH)
        if (cur.current.showOverlay) {
          if (cur.current.overlaySource === 'sam') {
            // x-ray A: the SAM-3D-Body rig (70 kp + bones), frame-indexed like pose.
            const sdoc = slotS3body.current[slot]
            if (sdoc && sdoc.kp.length && av.duration > 0) {
              const si = Math.max(0, Math.min(sdoc.kp.length - 1, Math.floor(dispT(slot, av) * (sdoc.fps || 24))))
              const skp = sdoc.kp[si]
              if (skp) drawSamOverlay(octx, skp, project)
            }
          } else if (fr) {
            drawOverlay(octx, fr, project, cssW, cssH) // x-ray B: bizarre com/face/kp
          }
        }
        // Face rig — its OWN overlay (not an x-ray mode): the anime-face-detector
        // 28-point landmarks, on by default. Frame-indexed like pose; coexists with
        // whatever x-ray (if any) is showing since both paint this same canvas.
        if (cur.current.showFace) {
          const fdoc = slotFace.current[slot]
          if (fdoc && fdoc.faces.length && av.duration > 0) {
            const fi = Math.max(0, Math.min(fdoc.faces.length - 1, Math.floor(dispT(slot, av) * (fdoc.fps || 24))))
            const ff = fdoc.faces[fi]
            if (ff) drawFaceOverlay(octx, ff.kp, project)
          }
        }
        // Mouth contour ('contour' mode): the SAM3 polygon as a debug outline.
        const mdoc = slotMouth.current[slot]
        if (cur.current.mouthMode === 'contour' && mdoc && mdoc.frames.length && av.duration > 0) {
          // floor (not round) of the PRESENTED time: the <video> shows frame floor(t*fps)
          // for the whole interval, and dispT is the frame actually on screen.
          const mi = Math.max(0, Math.min(mdoc.frames.length - 1, Math.floor(dispT(slot, av) * (mdoc.fps || 24))))
          const mf = mdoc.frames[mi]
          if (mf?.poly) drawMouthContour(octx, mf.poly, project)
        }
      }
      if (!playingFired.current) {
        const av = active.current === 0 ? a : b
        // Frozen: ready once the seek landed (frame decoded) and we've drawn it.
        // Live: ready once playback advances past 0. Either way the frame on screen
        // now is the one a screenshot will capture, so flag the canvas.
        const ready = freezeAt != null ? frozenSeeked.current && av.readyState >= 2 : av.readyState >= 2 && av.currentTime > 0
        if (ready) {
          playingFired.current = true
          cv.dataset.ready = '1'
          onPlay.current?.()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', sizeCanvas)
    }
  }, [])

  // Load a new clip into the inactive slot and cross-dissolve to it. Keyed on `seq`
  // (not `src`) so it re-runs on every advance even if the random pick repeats a clip.
  useEffect(() => {
    // Test freeze: seek to freezeAt and hold (don't play), so the render is a stable
    // single frame. Wire it on whichever element we're about to load into.
    const freeze = (v: HTMLVideoElement) => {
      frozenSeeked.current = false
      const seek = () => {
        v.currentTime = Math.max(0.01, freezeAt!)
      }
      v.addEventListener('loadeddata', seek, { once: true })
      v.addEventListener('seeked', () => (frozenSeeked.current = true), { once: true })
    }
    if (first.current) {
      first.current = false
      slotScale.current[0] = cur.current.scale
      slotAnchor.current[0] = cur.current.anchor
      slotPose.current[0] = poseRef.current
      slotMouth.current[0] = mouthRef.current
      slotS3body.current[0] = s3bodyRef.current
      slotFace.current[0] = faceRef.current
      lastLoaded.current = 0
      const v = vRef[0].current!
      v.src = src
      v.load() // Safari needs an explicit load() after setting src
      if (freezeAt != null) freeze(v)
      else v.play().catch(() => {})
      return
    }
    const incoming = 1 - active.current
    slotScale.current[incoming] = cur.current.scale // this clip's framing scale/anchor
    slotAnchor.current[incoming] = cur.current.anchor
    slotPose.current[incoming] = poseRef.current
    slotMouth.current[incoming] = mouthRef.current
    slotS3body.current[incoming] = s3bodyRef.current
    slotFace.current[incoming] = faceRef.current
    lastLoaded.current = incoming
    const v = vRef[incoming].current!
    v.src = src
    v.load() // Safari won't refetch a reused (ended) element on a bare src swap → froze
    if (freezeAt != null) freeze(v)
    else v.play().catch(() => {})
    pending.current = incoming // the draw loop blends to it once it's decoding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])

  // Pose JSON arrives async (after the clip is already loading), so assign it to the
  // slot the latest clip loaded into when it lands.
  useEffect(() => {
    slotPose.current[lastLoaded.current] = pose
  }, [pose])

  // Mouth JSON also arrives async — assign it to the slot the latest clip loaded into.
  useEffect(() => {
    slotMouth.current[lastLoaded.current] = mouth
  }, [mouth])

  // SAM-3D-Body rig JSON arrives async too — same late-assignment.
  useEffect(() => {
    slotS3body.current[lastLoaded.current] = s3body
  }, [s3body])

  // Face rig JSON arrives async too — same late-assignment.
  useEffect(() => {
    slotFace.current[lastLoaded.current] = face
  }, [face])

  // Frame scrubber: a number pins/pauses the active video to that frame; null resumes
  // autoplay. The draw loop keeps uploading the (paused) frame, so the contour holds too.
  useEffect(() => {
    const av = vRef[active.current].current
    if (!av || freezeAt != null) return
    if (scrub == null) {
      if (av.paused) av.play().catch(() => {})
    } else {
      av.pause()
      const t = Math.max(0, scrub) / (fps || 24)
      if (Math.abs(av.currentTime - t) > 1e-3) av.currentTime = t
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub, fps])

  // Three stacked layers that fill the wrapper: shadow (behind) → character (GL) →
  // x-ray overlay (on top). The GL canvas is transparent, so the shadow shows through
  // around her and she draws over it — a real contact shadow.
  const FILL: CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }
  return (
    <div style={{ position: 'relative', ...style }}>
      {/* Not display:none — Safari won't decode a display:none video (canvas stays
          blank). Render it tiny + transparent so frames keep flowing to the texture. */}
      <video ref={vRef[0]} muted playsInline preload="auto" style={HIDDEN_VIDEO} />
      <video ref={vRef[1]} muted playsInline preload="auto" style={HIDDEN_VIDEO} />
      <canvas ref={shadowRef} style={FILL} />
      <canvas ref={canvasRef} style={FILL} />
      <canvas ref={overlayRef} style={{ ...FILL, pointerEvents: 'none' }} />
    </div>
  )
}
