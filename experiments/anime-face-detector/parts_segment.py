#!/usr/bin/env python
"""Separate an anime face into part layers using the 28 landmarks.

Grouping (verified from hrnetv2.py swap-pairs):
  contour 0-4 | brows 5-10 (L5-7/R8-10) | eyes 11-22 (L11-16/R17-22)
  | nose 23 | mouth 24-27

Outputs, per input <name>:
  parts_<name>_index.jpg   - every landmark numbered (sanity check the scheme)
  parts_<name>_<part>.png  - RGBA cutout of each part (convex-hull mask, padded)
"""
import sys, os
import cv2
import numpy as np
from anime_face_detector import create_detector

GROUPS = {
    "contour": list(range(0, 5)),
    "brow_l":  [5, 6, 7],
    "brow_r":  [8, 9, 10],
    "eye_l":   list(range(11, 17)),
    "eye_r":   list(range(17, 23)),
    "nose":    [23],
    "mouth":   [24, 25, 26, 27],
}
SCRATCH = os.path.dirname(os.path.abspath(__file__))


def hull_mask(shape, pts, pad):
    m = np.zeros(shape[:2], np.uint8)
    pts = np.asarray(pts, np.float32)
    if len(pts) == 1:
        c = pts[0].astype(int)
        cv2.circle(m, tuple(c), max(pad, 8), 255, -1)
    elif len(pts) == 2:
        cv2.line(m, tuple(pts[0].astype(int)), tuple(pts[1].astype(int)), 255, max(pad, 8))
    else:
        cv2.fillConvexPoly(m, cv2.convexHull(pts.astype(np.int32)), 255)
        if pad:
            m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad, pad)))
    return m


def main():
    paths = sys.argv[1:] or ["/Users/jin/dev/monet/experiments/upscale-shader/src.webp"]
    det = create_detector("faster-rcnn", device="cpu")
    for path in paths:
        img = cv2.imread(path, cv2.IMREAD_COLOR)
        if img is None:
            print("skip", path); continue
        name = os.path.basename(path).rsplit(".", 1)[0]
        preds = det(img)
        if not preds:
            print("no face in", path); continue
        kp = np.asarray(max(preds, key=lambda p: p["bbox"][4])["keypoints"])  # best face

        # --- index overlay ---
        ov = img.copy()
        for i, (x, y, c) in enumerate(kp):
            cv2.circle(ov, (int(x), int(y)), 3, (0, 0, 255), -1)
            cv2.putText(ov, str(i), (int(x) + 4, int(y) - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 0), 1, cv2.LINE_AA)
        cv2.imwrite(f"{SCRATCH}/parts_{name}_index.jpg", ov)

        # --- per-part RGBA cutouts ---
        bgr = img
        diag = int(np.hypot(*img.shape[:2]))
        pad = max(6, diag // 120)
        for part, idx in GROUPS.items():
            pts = kp[idx, :2]
            m = hull_mask(img.shape, pts, pad if part in ("eye_l", "eye_r", "mouth") else pad // 2)
            ys, xs = np.where(m > 0)
            if len(xs) == 0:
                continue
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            crop = bgr[y0:y1 + 1, x0:x1 + 1]
            alpha = m[y0:y1 + 1, x0:x1 + 1]
            rgba = np.dstack([crop, alpha])
            cv2.imwrite(f"{SCRATCH}/parts_{name}_{part}.png", rgba)
        print(f"{name}: wrote index + {len(GROUPS)} part cutouts")


if __name__ == "__main__":
    main()
