#!/usr/bin/env python
"""Generate <clip>.thumbnail.webp for Monet clips — a transparent 640x640 cutout.

Source clips are stacked-alpha (W x 2H: top H = RGB on black, bottom H = white
silhouette/alpha). The thumbnail = top color composited with the bottom as alpha →
RGBA webp, matching the existing contents/monet/*.thumbnail.webp (640x640 RGBA).

No keyframeIndex assumed (clips lock frame 0 to idle) → default to frame 0; override
with --frame N or per-clip later. NON-DESTRUCTIVE: skips clips whose thumbnail exists
(FORCE=1 to overwrite).

  scripts/.venv/bin/python scripts/gen_thumbnail.py <contents_dir> [--glob '...'] [--frame 0]
"""
import os, glob, argparse
import numpy as np
import cv2
from PIL import Image


def make(mp4, frame_idx):
    cap = cv2.VideoCapture(mp4)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fi = max(0, min(frame_idx, n - 1))
    cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
    ok, f = cap.read()
    cap.release()
    if not ok:
        return None
    h2, w = f.shape[:2]
    h = h2 // 2
    color = cv2.cvtColor(f[:h, :w], cv2.COLOR_BGR2RGB)      # top = RGB
    alpha = cv2.cvtColor(f[h:, :w], cv2.COLOR_BGR2GRAY)     # bottom = silhouette → alpha
    rgba = np.dstack([color, alpha]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("contents")
    ap.add_argument("--glob", default=None)
    ap.add_argument("--frame", type=int, default=0)
    a = ap.parse_args()
    force = os.environ.get("FORCE", "") not in ("", "0")
    clips = sorted(glob.glob(a.glob or os.path.join(a.contents, "*.mp4")))
    # don't thumbnail sidecar mp4s (depth/normal)
    clips = [c for c in clips if not c.endswith((".depth.mp4", ".normal.mp4"))]
    wrote = skipped = failed = 0
    for c in clips:
        stem = os.path.basename(c)[:-4]
        out = os.path.join(a.contents, stem + ".thumbnail.webp")
        if os.path.exists(out) and not force:
            skipped += 1
            continue
        im = make(c, a.frame)
        if im is None:
            print(f"  ✗ {stem}: could not read frame"); failed += 1; continue
        im.save(out, "WEBP", quality=90, method=6)
        wrote += 1
        print(f"  ✓ {stem}.thumbnail.webp  ({im.size[0]}x{im.size[1]} frame {a.frame})")
    print(f"thumbnail.webp: wrote {wrote}, skipped {skipped}, failed {failed}"
          f"{' [FORCE]' if force else ''}")


if __name__ == "__main__":
    main()
