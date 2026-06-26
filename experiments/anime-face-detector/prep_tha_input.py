#!/usr/bin/env python
"""Frame an anime sprite into THA4's expected 512x512 RGBA input.

THA4 wants: 512x512, RGBA, background alpha=0, character upright & facing forward,
head in the upper-center (like data/images/lambda_00.webp — head ~1/3 height, top ~8% down).

We use the 28-landmark detector to locate the face, then place the *whole head* (face
scaled up to include hair/chin) at a canonical position and scale. Output preserves the
sprite's own alpha (transparent bg required).

Usage: prep_tha_input.py src.webp out_512.png [--head-frac 0.33] [--head-top 0.10]
"""
import sys
import numpy as np
import cv2
import PIL.Image
from anime_face_detector import create_detector

CANVAS = 512


def main():
    src, dst = sys.argv[1], sys.argv[2]
    head_frac = 0.33   # full head height as fraction of canvas
    head_top = 0.10    # head top position from canvas top, as fraction
    for i, a in enumerate(sys.argv):
        if a == "--head-frac": head_frac = float(sys.argv[i + 1])
        if a == "--head-top":  head_top = float(sys.argv[i + 1])

    pil = PIL.Image.open(src).convert("RGBA")
    rgba = np.array(pil)                       # HxWx4
    bgr = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2BGR)

    det = create_detector("faster-rcnn", device="cpu")
    preds = det(bgr)
    if not preds:
        print("no face found"); sys.exit(1)
    p = max(preds, key=lambda d: d["bbox"][4])
    x0, y0, x1, y1, sc = p["bbox"]
    face_h = y1 - y0
    face_cx = (x0 + x1) / 2
    # full head ~ 1.55x the face box (hair above + chin below); top of head above face box
    head_h = face_h * 1.55
    head_top_y = y0 - face_h * 0.45            # estimate hairline-to-crown above the face box
    head_cx = face_cx

    # scale so head_h -> head_frac*CANVAS
    scale = (head_frac * CANVAS) / head_h
    # after scaling, head top should land at head_top*CANVAS, head center-x at CANVAS/2
    # source point (head_cx, head_top_y) -> dest (CANVAS/2, head_top*CANVAS)
    tx = CANVAS / 2 - head_cx * scale
    ty = head_top * CANVAS - head_top_y * scale
    M = np.array([[scale, 0, tx], [0, scale, ty]], np.float32)

    out = cv2.warpAffine(rgba, M, (CANVAS, CANVAS),
                         flags=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    # hard-zero any stray alpha from interpolation edges
    out[:, :, 3] = np.where(out[:, :, 3] > 8, out[:, :, 3], 0)
    PIL.Image.fromarray(out, "RGBA").save(dst)
    print(f"face score={sc:.3f} box=({x0:.0f},{y0:.0f},{x1:.0f},{y1:.0f}) "
          f"scale={scale:.3f} -> {dst} ({CANVAS}x{CANVAS} RGBA)")


if __name__ == "__main__":
    main()
