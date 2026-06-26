# Stacked-alpha H.264 POC

Proves the v1 transparent-video approach (see `docs/008-video-rendering.md`):
a single H.264 MP4 (color top / alpha-as-luma bottom) composited to transparency
by a WebGL shader. **Verified transparent + animating in Chrome AND Safari.**

## Make a stacked clip from a VP9-alpha webm
Needs a libvpx ffmpeg (`/usr/local/bin/ffmpeg` here; ubuntu CI ffmpeg also has it):
```
/usr/local/bin/ffmpeg -c:v libvpx-vp9 -i in.webm \
  -filter_complex "[0:v]split=2[v1][v2];[v1]format=rgb24[c];[v2]alphaextract,format=rgb24[a];[c][a]vstack=inputs=2[out]" \
  -map "[out]" -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart clip.mp4
```

## View
Put `clip.mp4` next to `preview.html`, then:
```
python3 -m http.server 8899
# open http://localhost:8899/preview.html  (Chrome + Safari)
```
`preview.html` = minimal WebGL compositor (the real renderer will be Pixi; the
fragment shader is the same: sample top half → rgb, bottom half → alpha).
