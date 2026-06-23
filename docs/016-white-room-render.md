# 016 — White Room Render

How the white room (`/` — Monet's home) is drawn. Companion to `docs/015` (the
whiteroom scope) and `docs/008` (stacked-alpha video). Source of truth for the
render architecture, so the structure doesn't pivot.

> Origin (Jin): start by drawing the background (white-room gradient), then lay the
> `/preview` sampling logic on top. Begin unified so background-driven color shifts
> / weather *color-bleeding* onto Monet, and later an HDRI, are possible — then
> split into a composite when effects grow.

That intent is kept; it resolves into a scene graph rather than one megashader (see
*Why* below).

## Decision

A **real 3D world with a real perspective camera**, where Monet (and every future
entity) is a **Ragnarok-Online-style billboarded sprite**, composed through a
**scene graph**.

- The world is genuine 3D: real world coordinates, a perspective camera (view +
  projection matrices). But the room is an **empty soft void** — see *Background*.
- Entities are 2D sprite quads placed at 3D positions, always turned to face the
  camera (billboard). Perspective scales them with distance; depth orders them.
- Adding a character or a prop = **adding a node**, never editing a megashader.

### Why a scene graph, not one big shader

A single fullscreen-quad shader that bakes room + character together can't grow: a
second character means hand-adding samplers, uniforms, and a baked composite order
— combinatorial mess (Jin's own catch). A scene graph draws a **z-ordered list of
nodes** into one framebuffer, back-to-front; entities are just more nodes.

Our stacked-alpha sprite (`docs/008`: color top, alpha-as-luma bottom, composited
in a fragment shader) is *already* a 2D animation. Ragnarok's trick — a 2D sprite
on a billboard quad in a 3D world — fits it exactly: only the **vertex** stage
changes (MVP + billboard); the **fragment** stage (sample color / alpha, feather)
is unchanged from the `/preview` player.

Color bleeding / weather / HDRI: the room exposes ambient light as a uniform (later
an environment texture) that entity shaders sample to tint the sprite. Shared
*inputs*, not a shared program — so it still scales to N entities.

## Background — empty gradient void

> Jin: "그냥 그라데이션 급으로 아무것도 없어야 함."

The visible background is **only a soft procedural gradient**. No floor, no walls,
no props, no visible ground mesh (not RO's terrain). Monet stands in a quiet,
empty, soft-lit void. The floor plane (`y = 0`) exists in the math — for placement
and the contact shadow — but is **not drawn**.

## Lighting — white-room HDRI (as a hook)

> Jin: a white-room HDRI for the room is also recommended.

HDRI here means **image-based lighting**, not a drawn skybox: an environment that
*tints* the sprite with soft enveloping white-room light, while the background you
see stays a clean gradient. v0 ships a constant soft ambient that approximates it
(`uAmbient`); sampling a real white-room HDRI/equirect for the tint is the next
step on the same seam.

## Sprite fidelity — never pixelated

> Jin: "모넷 스프라이트가 픽셀레이트되게 깨지진 않았으면 좋겠어."

We use Ragnarok's *technique* (billboard in 3D), not its pixel-art crunch. Keep her
smooth and high-fidelity:

- `LINEAR` min/mag filtering on the sprite texture (not `NEAREST`).
- Canvas sized at `devicePixelRatio` (capped ~2) for crisp edges.
- Source frames are high-res (1024–2043 px); **never scale a sprite above its
  source resolution** — keep the camera/world scale so she renders at ≤ 1:1.
- If she ends up small/far enough to alias on minification, add mipmaps then
  (`LINEAR_MIPMAP_LINEAR`, regenerated per video frame) — deferred until needed.

## Camera

`gl-matrix` (`mat4.perspective` + `mat4.lookAt`). Default is a **cozy near-front
view**: camera a little above eye level, gentle downward tilt (~12–18°), Monet
centered with headroom — intimate, "you're in the room with her," not a steep RO
¾ (which would only reveal empty void floor here). Camera params are exposed in the
debug overlay and tunable; world is unitless (Monet ≈ 1.7 tall). Resize updates the
projection aspect.

## Scene graph

Shallow (flat z-sorted list now; `Node` can gain children later — YAGNI).

```
Scene
├─ RoomNode      gradient backdrop (the void). weather/HDRI hook lives here.
├─ ShadowNode    soft blob on the floor under a character (RO-style)   [debug toggle]
├─ CharacterNode Monet — billboarded stacked-alpha sprite at a 3D position
│                (future: more CharacterNodes / PropNodes, depth-sorted)
└─ PostNode      fullscreen vignette + grain overlay                    [debug toggle]
```

`Node`: `{ z, update(frame), draw(gl, frame), dispose() }`, `frame = { now, dt,
view, proj, ambient, ... }`. The `Renderer` owns the GL context, the node list, the
rAF loop, and resize; each frame it clears, then draws nodes back-to-front.

### CharacterNode (the body)

Owns two `<video>` elements (slot A / B) for the cross-dissolve, the active slot +
blend, the per-clip framing (scale + feet anchor from `framings.json`), and a world
position + facing. API: `setClip(src, framing)` (load into the idle slot,
crossfade), `update(now)` (advance blend, detect clip end → `onClipEnd`), `draw`.
This absorbs the crossfade logic `/preview`'s `Stage` has today; the node knows
nothing about the FSM.

## Render order, depth, blending

1. Clear (color = gradient base, depth = 1).
2. Gradient backdrop (drawn behind everything; depth write off).
3. Floor shadow quads: blended, on `y = 0`, just under their character.
4. Transparent sprites, **sorted back-to-front by camera distance**: blend
   `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`; depth **test on, write off** (alpha edges must
   not punch the depth buffer).
5. Post overlay (vignette / grain): fullscreen, blended, no depth.

Post that reads the composited frame (silhouette-blur shadow, bloom, DOF) needs an
FBO render-to-texture pass — **deferred** until an effect needs a prior pass's
pixels. Until then everything is multi-draw into one framebuffer (cheap).

## Shaders & GLSL conventions (from `../machi`)

- WebGL2, `#version 300 es`. Real files under `ui/src/scene/shaders/` (`*.vert`,
  `*.frag`), imported as strings via Vite `?raw`.
- Programs/textures built by `ui/src/scene/gl-utils.ts` (`createProgram`,
  `compileShader`, `createTexture`) — ported from machi, sprite textures forced to
  `LINEAR`.
- Files: `sprite.vert` (MVP + billboard), `sprite.frag` (stacked-alpha sample +
  feather + ambient tint), `backdrop.vert` + `backdrop.frag` (gradient), `quad.vert`
  + `post.frag` (vignette + grain), `shadow.frag`.

## Director / body split

`Whiteroom` (React) is the **director**: the idle-dominant FSM + the conversation
loop. It calls `characterNode.setClip(...)` to play idle / cozy / talk clips and
reads `onClipEnd` to advance. The scene is the **body / world**: pure rendering. The
split mirrors the living-being framing (`docs/015`).

## Debug

A **backtick (`` ` ``)** key opens an overlay: toggle contact shadow / vignette /
grain, and nudge camera params. Off by default.

## Tools

`/preview` and `/editor` keep the existing `Stage.tsx` (transparent single-entity
WebGL1 player) for now — stable, screenshot-tested. They converge onto
`CharacterNode` later; not in this change.

## Out of scope (v0)

Walls / props / multiple characters, weather, a real HDRI sample, FBO post passes,
camera rotation / steep ¾. Seams are left for all of them.
