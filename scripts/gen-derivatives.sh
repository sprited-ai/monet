#!/usr/bin/env bash
# Generate per-clip derivatives (bizarre.json + face.json + s3body.json + thumbnail.webp) for Monet clips —
# anywhere (Mac or gin). Runs whichever pipeline THIS machine has; missing ones are
# skipped with a note. NON-DESTRUCTIVE: every step skips clips whose output already
# exists, so nothing is overwritten (set FORCE=1 to regenerate s3body.json). Disk/speed/
# transfer are the operator's concern — this just processes clips in $CONTENTS and writes
# derivatives there.
#
# Override any path via env:
#   CONTENTS                 clip dir = derivative output dir   (default <repo>/contents/monet)
#   BIZARRE_DIR / BIZARRE_PY  bizarre estimator dir + its python
#   FACE_DIR / FACE_PY        anime-face-detector dir + its python
#   SAM_DIR / SAM_PY          SAM-3D-Body dir + its python
#   NPZ_DIR                  where SAM rig NPZs land          (default <repo>/experiments/sam3d-body/out)
#   FORCE=1                  regenerate s3body.json even if present
#
# See docs/017-clip-derivatives-pipeline.md.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$here/.." && pwd)"
CONTENTS="${CONTENTS:-$REPO/contents/monet}"
BIZARRE_DIR="${BIZARRE_DIR:-$REPO/experiments/bizarre-pose-estimator}"
BIZARRE_PY="${BIZARRE_PY:-$REPO/scripts/.venv/bin/python}"
FACE_DIR="${FACE_DIR:-$REPO/experiments/anime-face-detector}"
FACE_PY="${FACE_PY:-$FACE_DIR/.venv/bin/python}"
SAM_DIR="${SAM_DIR:-$HOME/dev/sam-3d-body}"
SAM_PY="${SAM_PY:-$SAM_DIR/.venv/bin/python}"
NPZ_DIR="${NPZ_DIR:-$REPO/experiments/sam3d-body/out}"
EXPORT_PY="$REPO/experiments/sam3d-body/export_s3body_json.py"
SAM_BATCH="$REPO/experiments/sam3d-body/sam3d_batch.py"

ncl=$(ls "$CONTENTS"/*.mp4 2>/dev/null | wc -l | tr -d ' ')
echo "● contents: $CONTENTS  ($ncl mp4)"
[ "$ncl" = 0 ] && { echo "  no .mp4 found — point CONTENTS at the clip dir"; exit 1; }

# ── bizarre.json — bizarre-pose-estimator (CPU) ──────────────────────────────
biz_ckpt="$BIZARRE_DIR/_train/character_pose_estim/runs/feat_concat+data.ckpt"
if [ -x "$BIZARRE_PY" ] && [ -f "$BIZARRE_DIR/_scripts/pose_data.py" ] && [ -f "$biz_ckpt" ]; then
  echo "● [bizarre.json]  bizarre → $CONTENTS  (skips existing)"
  if ( cd "$BIZARRE_DIR" && TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 "$BIZARRE_PY" \
        -m _scripts.pose_data "$CONTENTS" --glob "$CONTENTS/*.mp4" ); then
    echo "  ✓ bizarre.json done"
  else
    echo "  ✗ bizarre.json FAILED"
  fi
else
  echo "● [bizarre.json]  SKIP — bizarre env not here (py:$( [ -x "$BIZARRE_PY" ] && echo ok || echo missing ), ckpt:$( [ -f "$biz_ckpt" ] && echo ok || echo missing ))"
fi

# ── face.json — anime-face-detector 28-kp landmarks (CPU) ──────────────────
# CPU-only stack (OpenMMLab 1.x; mmcv ops won't build on gin's Blackwell/cu128, so
# this runs CPU everywhere). ~1.2 s/frame single-process. For a big first batch, split
# the file list across N processes by hand — see docs/017.
if [ -x "$FACE_PY" ] && [ -f "$FACE_DIR/face_data.py" ]; then
  echo "● [face.json]  anime-face-detector → $CONTENTS  (skips existing)"
  if ( cd "$FACE_DIR" && "$FACE_PY" face_data.py "$CONTENTS" --glob "$CONTENTS/*.mp4" ); then
    echo "  ✓ face.json done"
  else
    echo "  ✗ face.json FAILED"
  fi
else
  echo "● [face.json]  SKIP — anime-face-detector env not here (py:$( [ -x "$FACE_PY" ] && echo ok || echo missing ))"
fi

# ── s3body.json — SAM-3D-Body rig (CUDA on gin / MPS on mac) ───────────────
# Runs whatever $SAM_DIR is set up for: gin = pristine repo + CUDA; mac = the
# Apple-Silicon fork (scripts/setup-sam3d-mac.sh applies mac-mps-port.patch +
# native pymomentum/mhr). sam3d_batch.py auto-picks cuda/mps/cpu (SAM_DEVICE to
# force). PYTHONPATH lets monet's batch import the sam_3d_body package in $SAM_DIR;
# MPS fallback routes the few unsupported ops to CPU on mac.
sam_ckpt="$SAM_DIR/checkpoints/sam-3d-body-dinov3/model.ckpt"
if [ -x "$SAM_PY" ] && [ -f "$sam_ckpt" ]; then
  echo "● [s3body.json]  SAM rig → NPZ → JSON  (skips existing)"
  mkdir -p "$NPZ_DIR"
  if ( cd "$SAM_DIR" && PYTHONPATH="$SAM_DIR" PYTORCH_ENABLE_MPS_FALLBACK=1 \
        SAM3D_CKPT_DIR="$SAM_DIR/checkpoints/sam-3d-body-dinov3" \
        CLIP_DIR="$CONTENTS" OUT_DIR="$NPZ_DIR" "$SAM_PY" "$SAM_BATCH" ) \
     && CONTENTS="$CONTENTS" S3BODY_NPZ="$NPZ_DIR" "$SAM_PY" "$EXPORT_PY"; then
    echo "  ✓ s3body.json done"
  else
    echo "  ✗ s3body.json FAILED"
  fi
else
  echo "● [s3body.json]  SKIP — SAM env not here (py:$( [ -x "$SAM_PY" ] && echo ok || echo missing ), ckpt:$( [ -f "$sam_ckpt" ] && echo ok || echo missing ))"
  echo "    mac: run scripts/setup-sam3d-mac.sh to build the Apple-Silicon fork."
fi
# ── thumbnail.webp — transparent 640x640 cutout (CPU; ffmpeg-free, cv2+PIL) ───
# No keyframeIndex assumed → frame 0 (clips lock frame 0 to idle). Override THUMB_FRAME.
THUMB_PY="${THUMB_PY:-$REPO/scripts/.venv/bin/python}"
THUMB_FRAME="${THUMB_FRAME:-0}"
if [ -x "$THUMB_PY" ] && [ -f "$REPO/scripts/gen_thumbnail.py" ]; then
  echo "● [thumbnail.webp]  frame $THUMB_FRAME → $CONTENTS  (skips existing)"
  if "$THUMB_PY" "$REPO/scripts/gen_thumbnail.py" "$CONTENTS" --glob "$CONTENTS/*.mp4" --frame "$THUMB_FRAME"; then
    echo "  ✓ thumbnail.webp done"
  else
    echo "  ✗ thumbnail.webp FAILED"
  fi
else
  echo "● [thumbnail.webp]  SKIP — python missing ($THUMB_PY)"
fi

echo "● done."
