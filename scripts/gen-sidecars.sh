#!/usr/bin/env bash
# Generate per-clip sidecars (pose.json + s3body.json) for Monet clips — anywhere
# (Mac or gin). Runs whichever pipeline THIS machine has; the other is skipped with a
# note. NON-DESTRUCTIVE: every step skips clips whose output already exists, so nothing
# is overwritten (set FORCE=1 to regenerate s3body.json). Disk/speed/transfer are the
# operator's concern — this just processes clips in $CONTENTS and writes sidecars there.
#
# Override any path via env:
#   CONTENTS                 clip dir = sidecar output dir   (default <repo>/contents/monet)
#   BIZARRE_DIR / BIZARRE_PY  bizarre estimator dir + its python
#   SAM_DIR / SAM_PY          SAM-3D-Body dir + its python
#   NPZ_DIR                  where SAM rig NPZs land          (default <repo>/experiments/sam3d-body/out)
#   FORCE=1                  regenerate s3body.json even if present
#
# See docs/017-clip-sidecar-pipeline.md.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$here/.." && pwd)"
CONTENTS="${CONTENTS:-$REPO/contents/monet}"
BIZARRE_DIR="${BIZARRE_DIR:-$REPO/experiments/bizarre-pose-estimator}"
BIZARRE_PY="${BIZARRE_PY:-$REPO/scripts/.venv/bin/python}"
SAM_DIR="${SAM_DIR:-$HOME/dev/sam-3d-body}"
SAM_PY="${SAM_PY:-$SAM_DIR/.venv/bin/python}"
NPZ_DIR="${NPZ_DIR:-$REPO/experiments/sam3d-body/out}"
EXPORT_PY="$REPO/experiments/sam3d-body/export_s3body_json.py"
SAM_BATCH="$REPO/experiments/sam3d-body/sam3d_batch.py"

ncl=$(ls "$CONTENTS"/*.mp4 2>/dev/null | wc -l | tr -d ' ')
echo "● contents: $CONTENTS  ($ncl mp4)"
[ "$ncl" = 0 ] && { echo "  no .mp4 found — point CONTENTS at the clip dir"; exit 1; }

# ── pose.json — bizarre-pose-estimator (CPU) ──────────────────────────────
biz_ckpt="$BIZARRE_DIR/_train/character_pose_estim/runs/feat_concat+data.ckpt"
if [ -x "$BIZARRE_PY" ] && [ -f "$BIZARRE_DIR/_scripts/pose_data.py" ] && [ -f "$biz_ckpt" ]; then
  echo "● [pose.json]  bizarre → $CONTENTS  (skips existing)"
  if ( cd "$BIZARRE_DIR" && TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 "$BIZARRE_PY" \
        -m _scripts.pose_data "$CONTENTS" --glob "$CONTENTS/*.mp4" ); then
    echo "  ✓ pose.json done"
  else
    echo "  ✗ pose.json FAILED"
  fi
else
  echo "● [pose.json]  SKIP — bizarre env not here (py:$( [ -x "$BIZARRE_PY" ] && echo ok || echo missing ), ckpt:$( [ -f "$biz_ckpt" ] && echo ok || echo missing ))"
fi

# ── s3body.json — SAM-3D-Body (GPU; falls back to slow CPU) ────────────────
sam_ckpt="$SAM_DIR/checkpoints/sam-3d-body-dinov3/model.ckpt"
if [ -x "$SAM_PY" ] && [ -f "$sam_ckpt" ]; then
  echo "● [s3body.json]  SAM rig → NPZ → JSON  (skips existing)"
  mkdir -p "$NPZ_DIR"
  if ( cd "$SAM_DIR" && CLIP_DIR="$CONTENTS" OUT_DIR="$NPZ_DIR" "$SAM_PY" "$SAM_BATCH" ) \
     && CONTENTS="$CONTENTS" S3BODY_NPZ="$NPZ_DIR" "$SAM_PY" "$EXPORT_PY"; then
    echo "  ✓ s3body.json done"
  else
    echo "  ✗ s3body.json FAILED"
  fi
else
  echo "● [s3body.json]  SKIP — SAM env not here (py:$( [ -x "$SAM_PY" ] && echo ok || echo missing ), ckpt:$( [ -f "$sam_ckpt" ] && echo ok || echo missing ))"
fi
echo "● done."
