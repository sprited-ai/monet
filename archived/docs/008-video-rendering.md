# 008 — Transparent character video: rendering & format decision

## Context

The White Room composites transparent character clips (like animation cels) over
backgrounds + effects, in a public web app (Chrome + Safari + Firefox). Clips are
~640×640, ~120 frames, with alpha. The source clips are **VP9 webm with alpha**
(`alpha_mode=1`), in R2 (`monet-contents`).

## The constraint (why this was hard)

No single *native-alpha video* codec works cross-browser:

- **VP9-alpha webm** — Chrome/Firefox/Edge ✅, **Safari ✗** (falls back to black).
- **HEVC-alpha mov** — Safari ✅, **Chrome ✗** (Chrome decodes HEVC video but not its alpha).
- **AV1-alpha** — Apple AV1 is hardware-gated (M3+/iPhone 15 Pro+ only) + alpha support spotty.

Other options rejected:
- **Dual-format** (webm + HEVC): ~3× storage, HEVC-alpha encode is Apple-only (videotoolbox →
  macOS CI), and the 3× **multiplies per cel layer**. Also limits effects to DOM z-stacking.
- **Sprite sheets**: a 640²×120-frame clip explodes to a huge atlas and ~200 MB of decoded GPU
  memory per clip (all frames resident). Video's temporal compression is exactly why it wins here.

## Decision

**Render in Pixi (canvas/WebGL). Deliver clips as stacked-alpha H.264.**

- **Stacked-alpha H.264**: one standard H.264 MP4, frame = color (top half) over
  alpha-as-luma (bottom half). H.264 decodes on *every* browser; a WebGL/Pixi shader
  reconstructs `vec4(rgb, alpha)` at draw time. No alpha-codec dependency → no Safari gap.
- **Pixi** composites cels as sprite layers, runs the alpha shader, anchors sprites via the
  `origin`/`framing` metadata, and drives the underlying video element for loop in/out (trim).

### Evidence (verified)
- `monet-run-1`: stacked H.264 = **979 KB** vs source webm **1.8 MB** (smaller).
- WebGL shader compositing verified **transparent in Safari** (hardest target) — clean alpha.
- POC: `experiments/stacked-alpha-poc/` (ffmpeg recipe + minimal WebGL compositor).

## Pipeline

- **Source of truth** = VP9 webm in R2 (renderer-agnostic; keep it).
- **Derivative** = stacked-alpha H.264, generated in CI (**ubuntu** — its ffmpeg has libvpx to
  decode VP9 alpha), **changed files only**, uploaded to R2. No macOS runner, no HEVC.
- Decode needs a **libvpx** ffmpeg: CI ubuntu has it; locally `/usr/local/bin/ffmpeg` has it
  (the Homebrew `/opt/homebrew` build does **not**).

### ffmpeg recipe (webm → stacked H.264)
```
/usr/local/bin/ffmpeg -c:v libvpx-vp9 -i in.webm \
  -filter_complex "[0:v]split=2[v1][v2];[v1]format=rgb24[c];[v2]alphaextract,format=rgb24[a];[c][a]vstack=inputs=2[out]" \
  -map "[out]" -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart out.mp4
```

### Shader (composite)
```glsl
vec3 rgb = texture2D(t, vec2(uv.x, uv.y*0.5)).rgb;       // top half = color
float a  = texture2D(t, vec2(uv.x, 0.5 + uv.y*0.5)).r;    // bottom half = alpha (luma)
gl_FragColor = vec4(rgb, a);
```
