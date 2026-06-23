#!/usr/bin/env bash
# Build IG-ready Reels (1080x1920, looped, burned-in text) from stacked-alpha Monet clips.
# Spec: docs/013-ig-videos.md.  Text via PIL (this ffmpeg lacks drawtext).
# Output: ig/posts/NN-name.mp4
set -euo pipefail
cd "$(dirname "$0")/.."

CLIPS=contents/monet
OUT=ig/posts
TMP=$(mktemp -d)
GARDEN=ig/garden-bg.png
STAGE=ig/theater/stage-bg.png
mkdir -p "$OUT"
trap 'rm -rf "$TMP"' EXIT

# rows: id|clip|bg|lineA|lineB|yA|yB
ROWS=(
"01-painting|monet-paint-large-1|$GARDEN|they paint pictures.|i paint things that wake up.|300|300"
"02-cast|monet-cast-magic-1|$GARDEN|make a wish…|…oh. it heard me.|300|300"
"03-flower|monet-flower-magic-1|$GARDEN|a dead image —|or something you water.|300|300"
"04-nap|monet-doze-off|$GARDEN|i logged off for a sec.|she's still here.|300|300"
"05-hmph|monet-gets-angry-and-turns-back|$GARDEN|\"knew you wouldn't come.\"|(…what're you making?)|300|300"
"06-dance|monet-light-dance-1|$STAGE|no reason.|just happy you're here.|300|300"
"07-rain|monet-umbrella-large-1|$GARDEN|nothing has to bloom today.|let's just hear the rain.|300|300"
"08-feel|monet-talk-sad-stuff-large-1|$GARDEN|\"can a painting feel sad?\"|\"…but you came. so i'm okay.\"|300|300"
"09-run|monet-run-1|$STAGE|you opened the app—|i'm RUNNING, wait!|300|300"
"10-bread|monet-eat-bread|$GARDEN|behind the magic:|mostly just bread.|300|300"
)

for row in "${ROWS[@]}"; do
  IFS='|' read -r id clip bg la lb ya yb <<< "$row"
  src="$CLIPS/$clip.mp4"
  [ -f "$src" ] || { echo "MISSING $src"; continue; }
  python3 scripts/ig_text.py "$la" "$TMP/$id-a.png" "$ya"
  python3 scripts/ig_text.py "$lb" "$TMP/$id-b.png" "$yb"
  echo ">> $id  ($clip)"
  ffmpeg -y -loglevel error \
    -loop 1 -i "$bg" \
    -i "$src" \
    -loop 1 -i "$TMP/$id-a.png" \
    -loop 1 -i "$TMP/$id-b.png" \
    -filter_complex "\
[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg];\
[1:v]crop=640:640:0:0[c];[1:v]crop=640:640:0:640,format=gray[a];[c][a]alphamerge,scale=1000:-1[fg];\
[bg][fg]overlay=(W-w)/2:H-h-140:shortest=1[base];\
[2:v]format=rgba,fade=in:st=0:d=0.3:alpha=1,fade=out:st=2.1:d=0.3:alpha=1[ta];\
[base][ta]overlay=0:0:enable='between(t,0,2.4)'[b2];\
[3:v]format=rgba,fade=in:st=2.4:d=0.3:alpha=1,fade=out:st=4.7:d=0.3:alpha=1[tb];\
[b2][tb]overlay=0:0:enable='between(t,2.4,5)'[v]" \
    -map "[v]" -t 5 -r 24 -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/$id.mp4"
done

rm -f "$OUT/_test.mp4" "$OUT/_frame.png" 2>/dev/null || true
echo "== done =="; ls -la "$OUT"
