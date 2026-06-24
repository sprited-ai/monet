#!/usr/bin/env python
"""Smoke-test hysts/anime-face-detector on a few images.

Runs the detector, prints bbox + 28-landmark summary, and writes an
annotated copy (bbox in green, 28 keypoints in red) next to each input.

Usage:
    .venv/bin/python test_detect.py img1.jpg [img2.png ...]
If no args: runs on the bundled sample set.
"""
import sys
import os
import time
import cv2
import numpy as np
from anime_face_detector import create_detector

# 28-landmark connections (hysts' scheme): contour, eyes, mouth, nose.
# Kept minimal — we mainly want to *see* the points land on the face.
SCRATCH = os.path.dirname(os.path.abspath(__file__))


def annotate(img, preds, score_thr=0.3):
    out = img.copy()
    for p in preds:
        bbox = p["bbox"]
        x0, y0, x1, y1, score = bbox
        if score < score_thr:
            continue
        cv2.rectangle(out, (int(x0), int(y0)), (int(x1), int(y1)), (0, 255, 0), 3)
        cv2.putText(out, f"{score:.2f}", (int(x0), int(y0) - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
        for (kx, ky, kscore) in p["keypoints"]:
            color = (0, 0, 255) if kscore > 0.3 else (0, 165, 255)
            cv2.circle(out, (int(kx), int(ky)), 4, color, -1)
    return out


def main():
    paths = sys.argv[1:]
    if not paths:
        paths = [
            "/tmp/aniface_input.jpg",
            "/Users/jin/dev/monet/experiments/bizarre-pose-estimator/_samples/megumin.png",
            "/Users/jin/dev/monet/experiments/upscale-shader/src.png",
        ]

    device = "cpu"  # mmcv custom ops are CPU-only on this build
    print(f"creating detector (faster-rcnn) on device={device} ...")
    t0 = time.time()
    # 'yolov3' or 'faster-rcnn' for the face detector backbone
    detector = create_detector("faster-rcnn", device=device)
    print(f"  ready in {time.time()-t0:.1f}s")

    for path in paths:
        if not os.path.exists(path):
            print(f"SKIP (missing): {path}")
            continue
        img = cv2.imread(path)
        if img is None:
            print(f"SKIP (unreadable): {path}")
            continue
        t0 = time.time()
        preds = detector(img)
        dt = time.time() - t0
        print(f"\n{os.path.basename(path)}  [{img.shape[1]}x{img.shape[0]}]  "
              f"{len(preds)} face(s) in {dt:.2f}s")
        for i, p in enumerate(preds):
            x0, y0, x1, y1, sc = p["bbox"]
            kp = np.asarray(p["keypoints"])
            print(f"  face#{i}: score={sc:.3f} box=({x0:.0f},{y0:.0f},{x1:.0f},{y1:.0f}) "
                  f"kpts={kp.shape[0]} mean_kp_conf={kp[:,2].mean():.3f}")
        out = annotate(img, preds)
        dst = os.path.join(SCRATCH, "out_" + os.path.basename(path).rsplit(".", 1)[0] + ".jpg")
        cv2.imwrite(dst, out)
        print(f"  -> {dst}")


if __name__ == "__main__":
    main()
