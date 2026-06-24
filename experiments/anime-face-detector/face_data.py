#!/usr/bin/env python
"""Batch anime-face-landmark extraction over Monet's stacked-alpha clips.

Sibling to bizarre-pose-estimator/_scripts/pose_data.py — same idea, different
signal. Runs hysts/anime-face-detector (faster-rcnn face detector + 28-point
HRNetV2 landmark regressor) on every frame and saves the numbers as JSON, one
`<clip>.face.json` per clip, alongside the existing `.pose.json` / `.s3body.json`
sidecars (see docs/017).

Coords are normalized 0..1 to the COLOR (top-half) frame, origin top-left — the
same space as the other sidecars, so they map straight onto the sprite via the
renderer's inverse-shader transform.

Per frame we keep the single highest-score face (Monet is one character):
  bbox  = [x, y, w, h]  detector box (normalized)
  score = detector confidence
  kp    = [[x, y, conf] * 28]  landmark points (normalized), index map below.
A frame with no detection above threshold is stored as null.

28-point index map (hysts scheme; derived empirically on the Monet sprite —
upstream doesn't publish it — and labelled in image space, viewer's left/right):
  0-4   face contour (jaw / cheeks)
  5-7   eyebrow (image-left)      8-10  eyebrow (image-right)
  11-16 eye (image-left, 6pt)     17-22 eye (image-right, 6pt)
  23    nose
  24-27 mouth

Usage (from experiments/anime-face-detector/):
  .venv/bin/python face_data.py OUT_DIR CLIP.mp4 [CLIP.mp4 ...]
  .venv/bin/python face_data.py OUT_DIR --glob '/path/to/contents/monet/*.mp4'

Re-running skips clips whose JSON already exists (resume-friendly). For a big
batch, split the file list across N processes (the model is small; CPU-bound).
"""
import os
import sys
import glob
import time
import json
import subprocess

import cv2
import numpy as np
import torch
from anime_face_detector import create_detector

# Cap intra-op threads so N parallel workers don't oversubscribe the cores.
_THREADS = int(os.environ.get("FACE_THREADS", "0"))
if _THREADS:
    torch.set_num_threads(_THREADS)
    cv2.setNumThreads(_THREADS)

# ---- args ----
out_dir = sys.argv[1]
rest = sys.argv[2:]
if rest and rest[0] == "--glob":
    in_paths = sorted(glob.glob(rest[1]))
else:
    in_paths = rest
os.makedirs(out_dir, exist_ok=True)

DETECTOR = "faster-rcnn"
LANDMARK_MODEL = "hrnetv2 (anime-face-detector 0.0.9)"
SCORE_THR = 0.5          # face-box confidence to accept a detection
GRAY = 128               # neutral composite bg (see prep note below)

KEYPOINT_GROUPS = {
    "contour": [0, 1, 2, 3, 4],
    "eyebrow_l": [5, 6, 7],
    "eyebrow_r": [8, 9, 10],
    "eye_l": [11, 12, 13, 14, 15, 16],
    "eye_r": [17, 18, 19, 20, 21, 22],
    "nose": [23],
    "mouth": [24, 25, 26, 27],
}


def ffprobe_fps(p):
    r = subprocess.run(
        ["ffprobe", "-v", "0", "-of", "csv=p=0", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate", p],
        capture_output=True, text=True).stdout.strip()
    try:
        n, d = r.split("/")
        return round(float(n) / float(d), 3)
    except Exception:
        return None


def prep_color_frame(frame):
    """stacked-alpha BGR frame -> color top-half composited over neutral gray.

    The color top-half holds garbage RGB wherever alpha=0, and semi-transparent
    edges blend it into the background; compositing over gray (not white) keeps
    that junk neutral so the detector sees no false edges. Mirrors pose_data's
    0x808080 prep. Returns (bgr_uint8, (W, H)) of the color frame.
    """
    h, w = frame.shape[:2]
    hh = h // 2
    color = frame[:hh].astype(np.float32)
    alpha = frame[hh:hh * 2]
    if alpha.shape[0] != hh:                      # odd height guard
        alpha = alpha[:hh]
    a = cv2.cvtColor(alpha, cv2.COLOR_BGR2GRAY).astype(np.float32)[..., None] / 255.0
    flat = color * a + GRAY * (1.0 - a)
    return flat.astype(np.uint8), (w, hh)


def best_face(preds):
    """Highest-score detection above threshold, or None."""
    best = None
    for p in preds:
        sc = float(p["bbox"][4])
        if sc < SCORE_THR:
            continue
        if best is None or sc > best["bbox"][4]:
            best = p
    return best


def main():
    print(f"creating detector ({DETECTOR}) on cpu ...")
    t0 = time.time()
    detector = create_detector(DETECTOR, device="cpu")
    print(f"  ready in {time.time()-t0:.1f}s")

    print(f"{len(in_paths)} clip(s) -> {out_dir}")
    for ci, p in enumerate(in_paths):
        stem = os.path.splitext(os.path.basename(p))[0]
        outp = os.path.join(out_dir, f"{stem}.face.json")
        if os.path.exists(outp):
            print(f"[{ci+1}/{len(in_paths)}] {stem}: exists, skip")
            continue
        t0 = time.time()
        cap = cv2.VideoCapture(p)
        faces, w, h, n_frames, n_det = [], None, None, 0, 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            n_frames += 1
            color, (w, h) = prep_color_frame(frame)
            try:
                fp = best_face(detector(color))
            except Exception as e:
                fp = None
                print(f"    frame {n_frames-1} ERR {type(e).__name__}: {e}")
            if fp is None:
                faces.append(None)
                continue
            n_det += 1
            x0, y0, x1, y1, sc = fp["bbox"]
            kp = [[round(float(kx) / w, 5), round(float(ky) / h, 5), round(float(kc), 4)]
                  for kx, ky, kc in fp["keypoints"]]
            faces.append({
                "bbox": [round(x0 / w, 5), round(y0 / h, 5),
                         round((x1 - x0) / w, 5), round((y1 - y0) / h, 5)],
                "score": round(float(sc), 4),
                "kp": kp,
            })
        cap.release()
        if n_frames == 0:
            print(f"[{ci+1}/{len(in_paths)}] {stem}: NO FRAMES, skip")
            continue
        doc = {
            "clip": stem,
            "source": f"monet/{os.path.basename(p)}",
            "fps": ffprobe_fps(p),
            "frames": n_frames,
            "width": w, "height": h,
            "detector": DETECTOR,
            "landmark_model": LANDMARK_MODEL,
            "score_thr": SCORE_THR,
            "prep_bg": "0x808080",
            "coord_space": "normalized to color (top-half) frame, origin top-left",
            "keypoint_groups": KEYPOINT_GROUPS,
            "fields": {
                "bbox": "[x,y,w,h] face box (normalized)",
                "score": "detector confidence",
                "kp": "[[x,y,conf]*28] landmarks (normalized); see keypoint_groups",
            },
            "faces": faces,
        }
        with open(outp, "w") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        dt = time.time() - t0
        print(f"[{ci+1}/{len(in_paths)}] {stem}: {n_frames} frames, "
              f"{n_det} detected, {dt:.0f}s -> {outp}")
    print("done")


if __name__ == "__main__":
    main()
