# upscale-shader

Fragment-shader upscaling comparison. Low-res source → upscaled in-shader by 6 filters
side by side: **Nearest · Bilinear · Bicubic (Catmull-Rom) · Lanczos-3 · Anime4K-style edge-refine**,
plus the full-res reference.

Upscaling runs in **premultiplied RGBA** (RGB×A before filtering, so transparent texels can't
bleed color into edges) — all four channels are filtered, not just RGB. Results are composited over
a checkerboard so the upscaled alpha edge is visible.

## Run
```
python3 -m http.server 8731   # from this dir
```
- `index.html` — upscales the Monet sprite (`src.webp`, 1536px → 192px → upscaled). `#zoom` crops the face.
- `gen.html` — upscales a **self-generated** resolution test chart (Siemens star, rings, hairlines,
  checkerboard, text). `#zoom` crops the Siemens star (aliasing/ringing stress).

## Renders (`renders/`, 85% jpg)
| file | what |
|---|---|
| `upscale-grid.jpg` | Monet sprite, all 6 filters |
| `upscale-zoom.jpg` | face crop — filter differences |
| `gen-grid.jpg` | test chart, all 6 filters |
| `gen-zoom.jpg` | Siemens-star crop — the money shot (Lanczos halos vs Anime4K snap) |

## Takeaway
For crisp line/edge content: **Anime4K-style edge-refine ≥ Bicubic > Lanczos (halos) > Bilinear (mush) > Nearest (jaggies)**.
Anime4K = an ML-derived approach as pure GLSL (v1 = hand-crafted gradient-push mimicking the trained CNN;
v3 = actual CNN weights baked into the shader).
