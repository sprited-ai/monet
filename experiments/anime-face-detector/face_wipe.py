#!/usr/bin/env python
"""Spike: can we ERASE eyes/brows/nose/mouth from an anime face and leave clean skin?

Idea (Jin): face position is roughly detected, so just wiping the organs off the
face gives us a blank-face base to draw blink / lip-sync on top of (THA4 / Live2D
style). Anime faces are flat-shaded -> inpainting should be easy.

Per input <name>, writes facewipe/<name>_panel.png = a side-by-side of
  original | landmarks | organ-mask | wiped(Telea) | wiped(skin-fill)
so we can eyeball the win rate.
"""
import sys, os
import cv2
import numpy as np
from anime_face_detector import create_detector

ORGANS = {  # everything EXCEPT contour(0-4) -> what we wipe
    "brow_l": [5, 6, 7], "brow_r": [8, 9, 10],
    "eye_l": list(range(11, 17)), "eye_r": list(range(17, 23)),
    "nose": [23], "mouth": [24, 25, 26, 27],
}
HERE = os.path.dirname(os.path.abspath(__file__))


def hull(shape, pts, grow):
    m = np.zeros(shape[:2], np.uint8)
    pts = np.asarray(pts, np.float32)
    if len(pts) == 1:
        cv2.circle(m, tuple(pts[0].astype(int)), max(grow, 10), 255, -1)
    else:
        cv2.fillConvexPoly(m, cv2.convexHull(pts.astype(np.int32)), 255)
    if grow:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow, grow)))
    return m


def skin_fill(bgr, mask, kp):
    """Fill mask with skin tone sampled from RELIABLE skin spots (cheeks), not a
    ring (which grabs hair). Cheeks = midpoints between each eye-outer and the
    mouth corner; plus just under the nose."""
    eye_l_out, eye_r_out = kp[11, :2], kp[22, :2]
    mouth_l, mouth_r = kp[24, :2], kp[27, :2]
    nose = kp[23, :2]
    probes = [
        0.5 * (eye_l_out + mouth_l), 0.5 * (eye_r_out + mouth_r),  # cheeks
        nose + (nose - 0.5 * (eye_l_out + eye_r_out)),             # below nose
    ]
    samp = np.zeros(mask.shape, np.uint8)
    for px, py in probes:
        cv2.circle(samp, (int(px), int(py)), 6, 255, -1)
    samp &= ~mask
    skin = bgr[samp > 0]
    if len(skin) == 0:
        return bgr.copy()
    tone = np.median(skin, axis=0)
    out = bgr.copy()
    out[mask > 0] = tone
    # feather the seam so it melts into the cheeks
    soft = cv2.GaussianBlur(out, (0, 0), 3)
    a = (cv2.GaussianBlur(mask, (0, 0), 4).astype(np.float32) / 255)[..., None]
    return (soft * a + out * (1 - a)).astype(np.uint8)


def main():
    paths = sys.argv[1:]
    det = create_detector("faster-rcnn", device="cpu")
    for path in paths:
        img = cv2.imread(path)
        name = os.path.basename(path).rsplit(".", 1)[0]
        preds = det(img)
        if not preds:
            print("no face:", name); continue
        kp = np.asarray(max(preds, key=lambda p: p["bbox"][4])["keypoints"])
        diag = int(np.hypot(*img.shape[:2]))
        grow = max(8, diag // 90)

        mask = np.zeros(img.shape[:2], np.uint8)
        for part, idx in ORGANS.items():
            if "eye" in part:
                g = int(grow * 1.6)          # eyes are dark -> cover fully so no ghost
            elif len(idx) > 2:
                g = grow
            else:
                g = grow // 2                # nose is a single dot
            mask |= hull(img.shape, kp[idx, :2], g)

        lm = img.copy()
        for i, (x, y, c) in enumerate(kp):
            cv2.circle(lm, (int(x), int(y)), 2, (0, 0, 255), -1)

        wiped_telea = cv2.inpaint(img, mask, 6, cv2.INPAINT_TELEA)
        wiped_skin = skin_fill(img, mask, kp)
        maskbgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)

        panel = np.hstack([img, lm, maskbgr, wiped_telea, wiped_skin])
        outp = f"{HERE}/facewipe/{name}_panel.png"
        cv2.imwrite(outp, panel)
        # also the two wipes alone, full-res
        cv2.imwrite(f"{HERE}/facewipe/{name}_wiped_telea.png", wiped_telea)
        cv2.imwrite(f"{HERE}/facewipe/{name}_wiped_skin.png", wiped_skin)
        print("wrote", outp)


if __name__ == "__main__":
    main()
