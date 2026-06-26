#!/usr/bin/env bash
# Bake a boomerang LOOP clip from a frame range of a stacked clip: forward [A..B] then the
# reverse [B-1..A+1], concatenated → it loops seamlessly when played FORWARD (no backward
# scrub, which stalls the single-GOP WebCodecs decoder on mobile). This is the head-pat
# reaction — a happy head-sway lifted from monet-lookup-3. The renderer prebakes it to
# bitmaps (LoopClip) and loops it; see ui/src/scene/nodes/CharacterNode.ts. Key frames A/B
# were picked by eye (widest head-x swing in the looking-up/smiling zone): A=24 head-left/
# open-smile, B=40 head-right/peak-delight.
#
# Input is an already-stacked clip (plain h264 — no alpha decode), so any ffmpeg works.
#
# Usage (no args = regenerate the head-pat loop):
#   scripts/bake-loop.sh
#   scripts/bake-loop.sh INPUT.mp4 A B OUTPUT.mp4    # general: frames A..B (0-based, inclusive)
#
# NON-DESTRUCTIVE: skips an existing output (set FORCE=1 to re-bake). Override CRF/FPS via env.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$here/.." && pwd)"
IN="${1:-$REPO/contents/monet/monet-lookup-3.mp4}"
A="${2:-24}"
B="${3:-40}"
OUT="${4:-$REPO/contents/monet/monet-headpat-loop.mp4}"
FPS="${FPS:-24}"
CRF="${CRF:-18}"

command -v ffmpeg >/dev/null || { echo "✗ ffmpeg not found on PATH"; exit 1; }
[ -f "$IN" ] || { echo "✗ missing input: $IN"; exit 1; }
[ "$B" -gt "$A" ] || { echo "✗ need B > A (got A=$A B=$B)"; exit 1; }
if [ -f "$OUT" ] && [ -z "${FORCE:-}" ]; then
  echo "● skip (exists): $OUT   [FORCE=1 to re-bake]"; exit 0
fi

fwd_end=$((B + 1)) # trim end_frame is EXCLUSIVE → forward = frames [A, B]
rev_end=$((B - A)) # drop the reverse's first (= B, dup of forward's end) and last (= A, the loop seam)
# forward [A..B] + reverse [B-1..A+1] → 2*(B-A) frames, wraps A..B..A+1 → A seamlessly.
FILTER="[0:v]trim=start_frame=$A:end_frame=$fwd_end,setpts=PTS-STARTPTS,split[fwd][t];[t]reverse,trim=start_frame=1:end_frame=$rev_end,setpts=PTS-STARTPTS[rev];[fwd][rev]concat=n=2:v=1,fps=$FPS[out]"

mkdir -p "$(dirname "$OUT")"
echo "● bake loop: $(basename "$IN") frames [$A..$B] → $OUT"
if ffmpeg -y -v error -i "$IN" -filter_complex "$FILTER" -map '[out]' \
    -r "$FPS" -c:v libx264 -pix_fmt yuv420p -crf "$CRF" -preset slow -movflags +faststart "$OUT"; then
  dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,nb_frames \
    -of csv=p=0:s=x "$OUT" 2>/dev/null)
  echo "  ✓ $OUT  (${dims:-baked})"
else
  echo "  ✗ FAILED"; exit 1
fi
