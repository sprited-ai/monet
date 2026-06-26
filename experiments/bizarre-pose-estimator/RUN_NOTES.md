# Running bizarre-pose-estimator on Apple Silicon (native arm64)

Upstream: https://github.com/ShuhongChen/bizarre-pose-estimator (WACV2022, anime/illustration
pose estimation). Upstream ships a Docker+CUDA setup; this is the **CPU-only native macOS** recipe
we got working on `monet`'s repo-root `.venv` (Python 3.12, arm64). No GPU needed — the pose model's
detectron2 backbone is already hardcoded to CPU (`_train/character_pose_estim/models/passup.py`).

## Environment

Uses the repo-root venv at `/Users/jin/dev/monet/.venv`. Installed via `uv pip`:

- torch 2.12.1 + torchvision (arm64, CPU/MPS)
- **detectron2 0.6** — built from source, requires `--no-build-isolation` (torch must already be
  in the env at build time): `uv pip install --no-build-isolation 'git+https://github.com/facebookresearch/detectron2.git'`
- pytorch-lightning 2.6.5, kornia, opencv-contrib-python, scikit-image, scipy, scikit-learn,
  imagesize, torchmetrics, easydict, requests, matplotlib

## Model checkpoints

The original GDrive file IDs in the README are **dead**. The release folder
(`11bw47Vy-RPKjgd6yF0RzcXALvp7zB_wt`) now contains only `redirect.txt` pointing to a new folder
`1HyOKbl2iLYNFVN3FuL3ENSe_L47Cxk69`. Current file ID for the models zip (2.18 GB):

```
.venv/bin/python -m gdown 17N5PutpYJTlKuNB6bdDaiQsPSIkYtiPm -O bizarre_pose_models.zip
unzip -q bizarre_pose_models.zip -d _dl_tmp
rsync -a _dl_tmp/bizarre_pose_models/ ./        # merges _train/ and _data/ into repo root
rm -rf _dl_tmp bizarre_pose_models.zip
```

This places `_train/character_pose_estim/runs/feat_concat+data.ckpt` (+ feat_match, +data variants)
and the bg-seg / tagger checkpoints. (The zip is deleted after extraction; re-run the above to refetch.)

## Two fixes needed for modern torch/numpy

1. **torch ≥ 2.6 `weights_only` default flipped to True** → can't unpickle the 2021 Lightning
   checkpoints (they embed a `ModelCheckpoint` object). These are trusted official weights, so force
   the old behavior with an env var (no code edit):
   `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1`
2. **numpy 2.x removed `np.float` / `np.bool`** → patched `_util/twodee_v0.py` (lines 84-87) to use
   builtin `float` / `bool`. (Local edit to the cloned repo.)

PL auto-upgrades the checkpoints v1.1.5/v1.3.1 → v2.x on load; the warnings are harmless.

## Run

```
cd experiments/bizarre-pose-estimator
TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 ../../.venv/bin/python -m _scripts.pose_estimator \
    ./_samples/megumin.webp \
    ./_train/character_pose_estim/runs/feat_concat+data.ckpt
```

Prints a COCO-17 keypoint list + bbox and writes the skeleton overlay to
`./_samples/character_pose_estim.webp`. First run downloads matplotlib font cache + the detectron2
zoo backbone (`keypoint_rcnn_R_101_FPN_3x`, ~313 MB) — subsequent runs are fast.

Constraint (upstream): single, full-body character only. No multi-character or cropped images.
