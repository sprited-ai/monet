#!/usr/bin/env bash
# Regenerate Monet Studio animation clips: stacked-alpha .mp4 → VP9-less APNG (alpha),
# 480px / 15fps, drawn straight to the Studio's 2D canvas (drawImage grabs live frames).
# Heavy (~8MB each) so gitignored; rebuild from contents/monet/ with this.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=v1/public/studio-assets/clips
mkdir -p "$OUT"
conv() { # <clip-stem> <out-name>
  ffmpeg -y -hide_banner -loglevel error -i "contents/monet/$1.mp4" \
    -filter_complex "[0:v]crop=640:640:0:0,setsar=1[c];[0:v]crop=640:640:0:640,format=gray[a];[c][a]alphamerge,fps=15,scale=480:480,format=rgba[o]" \
    -map "[o]" -c:v apng -plays 0 -f apng "$OUT/$2.png"
}
conv monet-idle-1 idle;  conv monet-cast-magic-1 cast; conv monet-flower-magic-1 flower
conv monet-happy-1 happy; conv monet-greet-1 greet;     conv monet-light-dance-1 dance
conv monet-walk walk;     conv monet-sit-1 sit
echo "studio clips → $OUT"
