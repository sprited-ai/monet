#!/usr/bin/env bash
# Bake a stacked-alpha clip — the primary render asset (archived/docs/008 + docs/016) that
# the whiteroom shader (ui/src/scene/shaders/sprite.frag) samples: COLOR on the TOP half,
# ALPHA-as-luma on the BOTTOM half, vstacked into one mp4. This is the FIRST step of the
# pipeline; scripts/gen-derivatives.sh then reads the stacked mp4 to make pose/face JSON.
#
# Input is a VP9-alpha .webm (alpha_mode=1, from Seedance/ComfyUI). Decoding the alpha
# plane needs a **libvpx** ffmpeg + an explicit `-c:v libvpx-vp9`: the alpha rides in the
# WebM BlockAdditional and the native vp9 decoder silently drops it (alphaextract then
# yields a solid-white matte — the classic broken bake). We auto-pick a libvpx ffmpeg
# (/usr/local/bin/ffmpeg is the tessus build that has it; brew's lacks --enable-libvpx).
# The shader premultiplies, so RGB in transparent regions is free to be garbage.
# See docs/018-raw-clip-processing.md, experiments/stacked-alpha-poc/README.md.
#
# Usage:
#   scripts/bake-stacked.sh INPUT.webm [INPUT.webm...]   # → CONTENTS/<basename>.mp4
#   OUT=path/clip.mp4 scripts/bake-stacked.sh INPUT.webm # single explicit output
#
# NON-DESTRUCTIVE: skips an output that already exists (set FORCE=1 to re-bake).
# Override via env:
#   FFMPEG     ffmpeg binary to use (must have libvpx-vp9)  (default: auto-detect)
#   CONTENTS   output dir for derived basenames   (default <repo>/contents/monet)
#   OUT        explicit output path (single input only)
#   FPS        output frame rate                  (default 24 — all Monet clips)
#   CRF        libx264 quality                     (default 18)
#   FORCE=1    re-bake even if the output exists
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$here/.." && pwd)"
CONTENTS="${CONTENTS:-$REPO/contents/monet}"
FPS="${FPS:-24}"
CRF="${CRF:-18}"

[ "$#" -ge 1 ] || { echo "usage: $(basename "$0") INPUT.webm [INPUT.webm...]"; exit 1; }
[ -n "${OUT:-}" ] && [ "$#" -gt 1 ] && { echo "✗ OUT= takes a single input only"; exit 1; }

# Pick an ffmpeg whose vp9 decoder can read the WebM alpha plane (needs libvpx-vp9).
# grep without -q: -q closes the pipe on first match → ffmpeg SIGPIPEs → pipefail
# would mark the probe failed. Read all output, then test the match.
has_vpx() { "$1" -hide_banner -decoders 2>/dev/null | grep 'libvpx-vp9' >/dev/null 2>&1; }
FF=""
for c in "${FFMPEG:-}" /usr/local/bin/ffmpeg ffmpeg /opt/homebrew/bin/ffmpeg; do
  [ -n "$c" ] || continue
  ( command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] ) || continue
  if has_vpx "$c"; then FF="$c"; break; fi
done
[ -n "$FF" ] || { echo "✗ no ffmpeg with libvpx-vp9 found (brew's build lacks --enable-libvpx)."; \
  echo "  install one: brew install ffmpeg (some bottles) OR use the tessus build at /usr/local/bin/ffmpeg,"; \
  echo "  then re-run, or pass FFMPEG=/path/to/ffmpeg."; exit 1; }
echo "● ffmpeg (libvpx): $FF"

# COLOR (top) + ALPHA-as-luma (bottom), vstacked — the proven recipe (archived/docs/008).
FILTER='[0:v]split=2[v1][v2];[v1]format=rgb24[c];[v2]alphaextract,format=rgb24[a];[c][a]vstack=inputs=2[v]'

rc=0
for in in "$@"; do
  [ -f "$in" ] || { echo "✗ missing input: $in"; rc=1; continue; }
  base="$(basename "$in")"; base="${base%.*}"
  out="${OUT:-$CONTENTS/$base.mp4}"
  if [ -f "$out" ] && [ -z "${FORCE:-}" ]; then
    echo "● skip (exists): $out   [FORCE=1 to re-bake]"
    continue
  fi
  mkdir -p "$(dirname "$out")"
  echo "● bake: $in → $out"
  if "$FF" -y -v error -c:v libvpx-vp9 -i "$in" -filter_complex "$FILTER" -map '[v]' \
      -r "$FPS" -c:v libx264 -pix_fmt yuv420p -crf "$CRF" -preset slow -movflags +faststart "$out"; then
    probe="$(command -v ffprobe || echo "$(dirname "$FF")/ffprobe")"
    dims=$("$probe" -v error -select_streams v:0 -show_entries stream=width,height,nb_frames \
      -of csv=p=0:s=x "$out" 2>/dev/null)
    echo "  ✓ $out  (${dims:-baked})"
  else
    echo "  ✗ FAILED: $in"; rc=1
  fi
done
exit $rc
