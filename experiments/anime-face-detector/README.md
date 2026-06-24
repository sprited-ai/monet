# anime-face-detector (hysts) — macOS arm64 test

Test of [hysts/anime-face-detector](https://github.com/hysts/anime-face-detector):
a near-frontal **anime face detector** (faster-rcnn or yolov3) + a **28-point facial
landmark** regressor (HRNetV2). Upstream is "tested only on Ubuntu" — the official
`mim install` recipe does **not** work as-is on Apple Silicon. This folder has a
working recipe and a smoke test.

## Result
Works on CPU on M-series. 28 landmarks land accurately on our own assets:

| image | faces | notes |
|---|---|---|
| `assets/input.jpg` (official, 3072²) | **38** | crowd, all score >0.69, mean kp-conf ~0.92 |
| `megumin.png` (512²) | 1 | score 0.999 |
| Monet sprite `upscale-shader/src.png` (1536²) | 1 | score 0.999 — contour/eyes/brows/nose/mouth all correct |

~2.6s/image on CPU (model load ~ a few s, checkpoints auto-download on first run).

## Why it's fiddly (and the fixes baked into the recipe)
The whole stack is OpenMMLab **1.x-gen** (mmcv-full 1.x, mmdet 2.x, mmpose 0.x), which:
1. **mmcv-full has no arm64 wheel** → compiles from source (`MMCV_WITH_OPS=1`). The ops
   are **CPU-only** (no CUDA, no MPS kernel) → run the detector on `device="cpu"`.
2. **Build isolation pulls setuptools ≥80** (no `pkg_resources`) and **numpy 2.x** → both
   break the old C-extension builds. Fix: keep `setuptools<70`, `cython==0.29.36`,
   `numpy==1.26.4` **in the venv** and build with `--no-build-isolation`.
3. **mmpose 0.29 pins mmcv ≤ 1.7.0** (assert in `mmpose/__init__.py`) → build exactly
   `mmcv-full==1.7.0`, not 1.7.2.
4. **xtcocotools** (mmpose dep) ships a `.pyx`; needs cython+numpy present at build, no isolation.
5. **opencv-python 4.13 requires numpy≥2** → pin `opencv-python-headless==4.10.0.84`.
6. torch must be **≤2.0.x** for mmcv 1.x → `torch==2.0.1` / `torchvision==0.15.2`.

## Reproduce from scratch
```bash
cd experiments/anime-face-detector
uv venv --python 3.10 .venv
PIP=".venv/bin/pip"
$PIP install pip "setuptools<70" wheel "cython==0.29.36" "numpy==1.26.4"
$PIP install "torch==2.0.1" "torchvision==0.15.2" "opencv-python-headless==4.10.0.84"
MMCV_WITH_OPS=1 $PIP install "mmcv-full==1.7.0" --no-build-isolation   # compiles ~2-3 min
$PIP install xtcocotools --no-build-isolation
$PIP install "mmdet==2.28.2" "mmpose==0.29.0" --no-deps
$PIP install pycocotools terminaltables json_tricks munkres chumpy scipy six "numpy==1.26.4"
$PIP install "anime-face-detector==0.0.9" --no-deps
```
Or restore the exact set: `.venv/bin/pip install -r requirements.lock.txt --no-build-isolation`
(mmcv-full still compiles; everything else resolves).

## Run the test
```bash
.venv/bin/python test_detect.py                 # bundled samples (official + megumin + Monet)
.venv/bin/python test_detect.py path/to/img.png # your own
```
Writes `out_<name>.jpg` per input: green bbox + score, red dots = 28 keypoints
(orange = low-confidence point).

## API, minimal
```python
from anime_face_detector import create_detector
import cv2
det = create_detector("faster-rcnn", device="cpu")   # or "yolov3"
preds = det(cv2.imread("img.png"))
# preds[i]["bbox"] = [x0,y0,x1,y1,score]; preds[i]["keypoints"] = 28x[x,y,conf]
```

## Why this matters for Monet
The 28-point landmark scheme (eyes, brows, nose, mouth, contour) lands cleanly on the
whiteroom Monet sprite — a usable signal for face-aware behavior (gaze target, blink/
expression anchoring, auto-crop/reframe) without hand-annotating keypoints.
