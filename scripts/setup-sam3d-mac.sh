#!/usr/bin/env bash
# Build the Apple-Silicon (MPS) fork of SAM-3D-Body so gen-derivatives.sh can produce
# s3body.json on a Mac (no gin needed). Idempotent — re-run anytime.
#
# What it does:
#   1. clone facebookresearch/sam-3d-body → $SAM_DIR (default ~/dev/sam-3d-body)
#   2. py3.12 uv venv + core inference deps + NATIVE pymomentum-cpu + mhr
#      (the native MHR replaces the float64 TorchScript path that MPS can't run)
#   3. download MHR model assets (public GitHub release, ungated) into site-packages/assets
#   4. apply mac-mps-port.patch (backbone→MPS, MHR-FK→CPU device handoff)
#   5. fetch sam-3d-body checkpoints (scp from gin if reachable; else print HF instructions)
#
# Then: scripts/gen-derivatives.sh  (the s3body step now runs on MPS).
# See experiments/sam3d-body/MAC_MPS_PORT.md for the why.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAM_DIR="${SAM_DIR:-$HOME/dev/sam-3d-body}"
PATCH="$REPO/experiments/sam3d-body/mac-mps-port.patch"
CKPT_DIR="$SAM_DIR/checkpoints/sam-3d-body-dinov3"
SP=""  # site-packages, resolved after venv

echo "● SAM_DIR = $SAM_DIR"

# 1. clone ------------------------------------------------------------------
if [ ! -d "$SAM_DIR/.git" ]; then
  echo "● cloning sam-3d-body ..."
  git clone --depth 1 https://github.com/facebookresearch/sam-3d-body.git "$SAM_DIR"
else
  echo "● repo present"
fi

# 2. venv + deps ------------------------------------------------------------
if [ ! -x "$SAM_DIR/.venv/bin/python" ]; then
  echo "● creating py3.12 venv (pymomentum-cpu wheels are cp312/cp313 only) ..."
  uv venv --python 3.12 "$SAM_DIR/.venv"
fi
source "$SAM_DIR/.venv/bin/activate"
echo "● installing deps (torch + sam core + native pymomentum/mhr) ..."
uv pip install -q torch torchvision numpy opencv-python pillow scipy \
  pytorch-lightning yacs scikit-image einops timm dill pandas rich hydra-core \
  hydra-colorlog pyrootutils "networkx==3.2.1" roma joblib huggingface_hub optree \
  fvcore omegaconf loguru braceexpand webdataset chump jsonlines appdirs seaborn \
  pymomentum-cpu mhr
SP="$("$SAM_DIR/.venv/bin/python" -c 'import site; print(site.getsitepackages()[0])')"

# 3. MHR assets -------------------------------------------------------------
if [ ! -f "$SP/assets/lod1.fbx" ]; then
  echo "● downloading MHR assets (facebookresearch/MHR release, ~199MB) ..."
  tmp="$(mktemp -d)"
  gh release download v1.0.1 --repo facebookresearch/MHR --pattern assets.zip --dir "$tmp" --clobber
  unzip -o -q "$tmp/assets.zip" -d "$tmp/unz"
  mkdir -p "$SP/assets"
  cp "$tmp"/unz/assets/* "$SP/assets/"
  rm -rf "$tmp"
else
  echo "● MHR assets present"
fi

# 4. apply the MPS patch (reset first → idempotent) -------------------------
echo "● applying mac-mps-port.patch ..."
( cd "$SAM_DIR" && git checkout -- sam_3d_body/ 2>/dev/null; git apply "$PATCH" \
    && echo "  ✓ patched" || echo "  ✗ patch failed (already applied? check git status)" )

# 5. checkpoints ------------------------------------------------------------
if [ ! -f "$CKPT_DIR/model.ckpt" ]; then
  echo "● checkpoints missing. Trying scp from gin ..."
  if ssh -o ConnectTimeout=6 -o BatchMode=yes gin 'test -f ~/dev/sam-3d-body/checkpoints/sam-3d-body-dinov3/model.ckpt' 2>/dev/null; then
    mkdir -p "$SAM_DIR/checkpoints"
    scp -r gin:~/dev/sam-3d-body/checkpoints/sam-3d-body-dinov3 "$SAM_DIR/checkpoints/"
    echo "  ✓ checkpoints from gin"
  else
    echo "  ✗ gin unreachable. Download manually (HF-gated — request access first):"
    echo "      huggingface-cli download facebook/sam-3d-body-dinov3 --local-dir $CKPT_DIR"
  fi
else
  echo "● checkpoints present"
fi

echo "● done. Now: scripts/gen-derivatives.sh   (s3body runs on MPS)"
