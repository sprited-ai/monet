#!/usr/bin/env python
"""Auto-detect a SAM3 mouth seed for every Monet clip.

For each contents/monet/*.mp4 (stacked-alpha: top half = RGB char on black, bottom
= white-silhouette matte), try a few frames, run the 28-landmark anime face detector,
and emit a seed: a tight mouth box (lm 24-27) + a positive point at the mouth + negative
points on the nose (lm 23) and both cheeks. Coords normalized 0..1 over the color frame
(= the sprite shader's u-space). Clips with no detectable face (e.g. back-facing) are
skipped → no mouth.json, and the shader simply doesn't erase.
"""
import os, glob, json
import numpy as np, cv2
from anime_face_detector import create_detector

CLIPS = sorted(glob.glob("/Users/jin/dev/monet/contents/monet/*.mp4"))
det = create_detector("faster-rcnn", device="cpu")
seeds, skipped = {}, []

for mp4 in CLIPS:
    name = os.path.basename(mp4)[:-4]
    cap = cv2.VideoCapture(mp4)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    found = None
    for fi in [0, n // 4, n // 2, 3 * n // 4]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ok, fr = cap.read()
        if not ok:
            continue
        H = fr.shape[0] // 2
        rgb, matte = fr[:H], fr[H:, :, 0]
        al = (matte / 255.0)[..., None]
        ow = (rgb * al + 255 * (1 - al)).astype(np.uint8)  # char on white
        preds = det(ow)
        if not preds:
            continue
        p = max(preds, key=lambda d: d["bbox"][4])
        if p["bbox"][4] < 0.9:
            continue
        kp = np.asarray(p["keypoints"])
        m = kp[[24, 25, 26, 27], :2]      # mouth corners + top/bottom
        nose = kp[23, :2]
        cx, cy = m.mean(0)
        x0, y0 = m.min(0)
        x1, y1 = m.max(0)
        W, Hh = ow.shape[1], ow.shape[0]
        fw = p["bbox"][2] - p["bbox"][0]   # face width → cheek offset
        pad = max(4.0, fw * 0.05)
        found = {
            "seed_frame": fi,
            "imgwh": [W, Hh],
            "box": [round((x0 - pad) / W, 4), round((y0 - pad) / Hh, 4),
                    round((x1 + pad) / W, 4), round((y1 + pad) / Hh, 4)],
            "pos": [round(cx / W, 4), round(cy / Hh, 4)],
            "neg": [[round(nose[0] / W, 4), round(nose[1] / Hh, 4)],
                    [round((cx - fw * 0.34) / W, 4), round(cy / Hh, 4)],
                    [round((cx + fw * 0.34) / W, 4), round(cy / Hh, 4)]],
        }
        break
    if found:
        seeds[name] = found
        print(f"OK   {name}  (frame {found['seed_frame']})")
    else:
        skipped.append(name)
        print(f"SKIP {name}  (no face)")

json.dump(seeds, open("/tmp/mouth_seeds.json", "w"))
print(f"\n{len(seeds)}/{len(CLIPS)} seeded, {len(skipped)} skipped: {skipped}")
