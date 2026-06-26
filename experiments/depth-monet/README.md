# depth-monet

Depth maps for the stacked-alpha Monet clips in `contents/monet/`.

**Why:** Jin wants to **throw a 3D object at the character and have it stick** to
her surface in the whiteroom. That needs per-pixel depth (where the object lands
in Z) + surface normal (which way it lies). Depth maps give both.

## Verdict

✅ **Works. Use ML video depth — Video Depth Anything (vitl) on gin.**

| stick requirement | result |
|---|---|
| landing Z (where it stops) | ✅ cupped hands in `cast-magic` read clearly **nearer** than the body — real depth separation |
| stick orientation (normal) | ✅ usable normal map derived from the depth gradient |
| temporal stability (anchor doesn't jitter) | ✅ Video-DA is 1.25× steadier than per-frame DA-V2; abs flicker 0.018 (small) |
| raw Z (not just a viz) | ✅ float Z saved as EXR / npz |

**Synthetic depth-from-alpha (GPU-free, distance transform) — rejected** for this
use: it only makes a smooth "balloon", an extended hand reads flat. Fine for
relighting, not for stick. See col 5/6 of the compare PNGs.

**Limit:** depth solves *the moment of impact* (land + orient). Keeping the object
stuck **as the body moves** is a separate problem — optical flow (RAFT) or a point
tracker (CoTracker). For near-static idle clips, impact-only is already convincing.

## Speed

vitl, 121-frame clip ≈ **5 s** on gin (RTX PRO 6000). All 64 clips ≈ **6 min**.

## Inputs / format

Clips are stacked-alpha: `W × 2H`, top H = RGB on black, bottom H = white
silhouette (alpha matte). We run depth on the **top half**, then mask by the
**bottom half** so only the character carries depth.

## Files

- `run_video_da.py` — batch runner (on gin). stacked clip → masked gray depth mp4
  + `*_depth.npz` (float32 relative depth `[T,H,W]` + alpha) + RGB|depth montage.
- `analyze.py` — from npz: normal map, Lambert relight, synthetic baseline; writes
  `*_compare.png` (RGB | ML-depth | ML-normal | ML-relit | synth-depth | synth-normal)
  and `*_stickdemo.mp4`.
- `flicker_test.py` — per-frame DA-V2 vs temporal Video-DA frame-to-frame jitter.
- `geodesic_spread.py` — **surface-effect PoC**: drop a liquid, it spreads by
  geodesic distance over the depth height-field (Dijkstra on the silhouette graph,
  edge weight = 3D distance). Follows the body around depth gaps instead of jumping
  screen-flat. Writes `*_liquid_spread.mp4` + `*_spread_steps.png`. This is the
  substrate for liquid/frost/paint/glow/dissolve effects (generalizes the head-pat
  hair-gloss-flow). Validated on cast-magic: chest drop → neck→face & body→skirt.
- `workflows/monet_stacked_video_depth.json` — **GUI-usable** ComfyUI workflow
  (Load video → Image Crop Location top 640² → Video-DA → gray mp4 + EXR). Also
  installed on gin at `~/dev/ComfyUI/user/default/workflows/`.
- `out/` — sample outputs for monet-walk, cast-magic-1, jump-large-1.

## Run (on gin)

```bash
# venv = ~/dev/ComfyUI/venv ; clips in ~/dev/depth-monet/in
cd ~/dev/depth-monet
~/dev/ComfyUI/venv/bin/python run_video_da.py in/<clip>.mp4 --encoder vitl
~/dev/ComfyUI/venv/bin/python analyze.py out/<clip>_depth.npz --rgbclip in/<clip>.mp4 --out out
```

## ComfyUI nodes installed on gin

- `ComfyUI-Video-Depth-Anything` (yuvraj108c) — temporal video depth + EXR save
- `ComfyUI-DepthAnythingV2` (kijai) — per-frame depth (`DownloadAndLoadDepthAnythingV2Model`)

Models cached at `~/dev/ComfyUI/models/videodepthanything/`.

## Storage (shipped — all 64 clips)

Depth is stored as a **per-clip sidecar** `contents/monet/<name>.depth.mp4`
(matching the existing `<name>.bizarre.json` / `<name>.mouth.json` convention; runtime
URL `/contents/monet/${name}.depth.mp4`). Masked gray, **per-clip** normalized so a
body part doesn't flicker in brightness frame-to-frame, libx264 crf 10. ~30 MB for
all 64. NOT stacked into the RGB clip. Each `.depth.mp4` is 1:1 with its source
(same frame count, same color-half dims: 57× 640², 7× 864×496).

`measure-contents.py` skips `.depth.` files so they don't enter index.json;
`sync-contents-to-r2.mjs` mirrors them to R2 for prod automatically. Stacking is only a *delivery* choice for the
shader, independent of storage — a standalone depth video backs every downstream
path. Frame sync is by **index, not time**: depth frame N ↔ RGB frame N by 1:1
construction, and `CharacterNode.shownIdx` already names the exact uploaded frame
(the reason we went WebCodecs). So `depth[shownIdx]` (CPU) or
`depthClip.frameAt(shownIdx)` (2nd decoder) can never drift.

## Getting depth to runtime — three paths (no single "stack or bust")

| path | stack? | how | use |
|---|---|---|---|
| 3-row stack | yes | one decoder, RGB/alpha/depth in one texture | per-pixel surface FX, simplest sync |
| two decoders | no | depth clip decoded in lockstep by index → 3rd texture | per-pixel surface FX, no re-encode |
| CPU sampling | no | sample depth+normal at impact in JS; object is a separate 3D node | **collision / bounce** (no shader change) |

**Current target = bounce** (thrown object hits her and ricochets, no stick): that's
the **CPU-sampling** path. Decode the depth mp4 when a throw happens, sample depth at
the hit (x,y) for the surface Z, derive the normal from the local depth gradient,
reflect velocity `v' = v - 2(v·n)n`. The depth normal's Z is what makes the ball
bounce *out toward the camera* off her chest — a flat silhouette normal can't.
No stacking, depth never enters the shader.

## Normal maps — bake-off (2026-06-24)

Depth gives "same part → same value" (smooth, low-frequency), so its **gradient**
(= a derived normal) loses surface detail (folds, hair, face relief) and adds edge
noise. Tested dedicated normal models on the chibi:

| model | kind | detail | video | speed | on gin |
|---|---|---|---|---|---|
| depth-derived (Sobel of Video-DA) | — | low + edge noise | temporally consistent (free) | instant | ✅ |
| NormalBae (controlnet_aux) | feedforward | very smooth / flat | per-frame | fast | ✅ |
| Marigold-Normals (diffusers) | img diffusion | **high** | ❌ per-frame flicker | slow | ✅ |
| **NormalCrafter** (ICCV'25) | **SVD video diffusion** | **high** (Marigold-level) | ✅ **temporally consistent** | ~50s/clip | ✅ installed |

ViGeo (feedforward, joint depth+normal+pointmap, 2026) and Buffer Anytime (NVIDIA,
joint, CVPR'25) are the joint-consistency candidates but no usable code release yet
(ViGeo) / not tested. NormalCrafter is the runnable video-native winner.

**Verdict:** bounce → depth-derived (free, consistent with collision depth). Video
per-pixel surface FX (detail matters) → **NormalCrafter**. Evidence:
`out/monet-cast-magic-1_normal_ALL.webp` (5-way still),
`out/monet-walk_normalcrafter.mp4` (temporal).

Runners: `normal_bakeoff.py` (depth-derived / NormalBae / Marigold),
`run_normalcrafter.py` (video normals). NormalCrafter node installed on gin at
`custom_nodes/ComfyUI-NormalCrafterWrapper` (SVD-XT base auto-downloaded, no gating
hit). controlnet_aux import needs a `sys.modules['mediapipe']=MagicMock()` stub
(its mediapipe→tensorflow chain is broken in that venv).

## Shader integration (only if per-pixel surface FX later)

Current `sprite.frag` samples a **2-row** stack: color = top half
`texture(t, vec2(u.x, u.y*0.5))`, alpha = bottom half `0.5 + u.y*0.5`.

To carry depth: extend to a **3-row** stack `RGB / alpha / depth` (W × 3H). One
WebCodecs decoder, one texture, perfect sync — change the two constants to `/3.0`
and add one sample:
```glsl
vec3  rgb = texture(t, vec2(u.x,         u.y/3.0)).rgb;  // top   color
float a   = texture(t, vec2(u.x, 1.0/3.0 + u.y/3.0)).r;  // mid   alpha
float d   = texture(t, vec2(u.x, 2.0/3.0 + u.y/3.0)).r;  // bottom depth
```
NOT channel-packing (alpha→R, depth→G): h264 yuv420 subsamples chroma, so packed
channels bleed at edges. Vertical (luma) separation survives compression.

Precision: 8-bit lossy depth is fine for surface effects, OK-ish for visual
collision. For precise Z later, pack 16-bit across two rows or a separate stream.

## Future option: shadow casting (parked)

With depth + normal we can do shadows later (not built yet):
- **Self-shadow (relief)** — screen-space ray-march per pixel toward the light over
  the depth height-field; a closer sample along the ray = in shadow. Adds 3D form
  the baked albedo doesn't have (arm-on-skirt, hair-on-face). The big win.
- **Floor/contact shadow** — project the silhouette (alpha) + depth onto the room
  floor from the light → upgrade the current blob contact shadow to a real shape.
- **Thrown object ↔ character** — approximate (project onto each other's surface).

Limit: monocular depth is 2.5D (front surface only) → height-field shadows, not a
full 3D-mesh caster. Good enough for these cases. Pairs with the whiteroom's
existing contact-shadow system.

## Next

1. Batch all 64 clips → bake depth (3-row re-encode `_d.mp4` for the shader).
2. Wire the 3-row sample into `sprite.frag` / CharacterNode.
3. Stick demo: throw a ball, land + orient via depth/normal.
4. Surface effects on the depth substrate (liquid spread proven).
5. (phase 2) flow tracking so effects follow the body across frames.
