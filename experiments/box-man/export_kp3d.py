#!/usr/bin/env python3
"""Export SAM-3D-Body 3D keypoints + camera (npz) → compact JSON the web can fetch.

box-man wants a *3D* puppet rendered with the SAME camera as the original clip, so the
boxes sit exactly where Monet is in the footage. The verified SAM projection is a plain
pinhole:  px = f*(X+tx)/(Z+tz) + W/2 ,  py = f*(Y+ty)/(Z+tz) + H/2   (image Y is down;
reproduces pred_keypoints_2d to 0.0 px). So we ship the 3D keypoints + per-frame camera
(cam_t, focal) + W,H, and the renderer replicates that projection.

Motion is Savitzky-Golay smoothed along time (the raw rig jitters → boxes buzz/overlap).

Writes contents/monet/<clip>.s3body3d.json (gitignored; npz + this script are the truth):
  { clip, fps, frames, W, H, kp3d:[F][70][x,y,z], cam_t:[F][3], focal:[F], valid:[F] }

Usage:  python3 experiments/box-man/export_kp3d.py [clip ...]   # default: all
"""
import glob
import json
import os
import sys

import numpy as np
from scipy.signal import savgol_filter

OUT_DIR = "contents/monet"
NPZ_DIR = "experiments/sam3d-body/out"
SG_WINDOW = 11   # ~0.45s at 24fps — kills buzz, keeps the gesture
SG_POLY = 3


def smooth(a: np.ndarray) -> np.ndarray:
    """Savitzky-Golay along the time axis (axis 0). No-op if too few frames."""
    f = a.shape[0]
    w = min(SG_WINDOW, f if f % 2 == 1 else f - 1)
    if w <= SG_POLY or w < 3:
        return a
    return savgol_filter(a, w, SG_POLY, axis=0)


def r(a: np.ndarray, nd: int) -> list:
    return np.round(a, nd).tolist()


def export(npz_path: str) -> str:
    clip = os.path.basename(npz_path)[:-4]
    d = np.load(npz_path, allow_pickle=True)
    kp3d = smooth(d["pred_keypoints_3d"].astype(np.float64))  # (F,70,3)
    cam_t = smooth(d["pred_cam_t"].astype(np.float64))        # (F,3)
    obj = {
        "clip": clip,
        "fps": float(d["fps"]),
        "frames": int(d["frames"]),
        "W": int(d["W"]),
        "H": int(d["H"]),
        "kp3d": r(kp3d, 4),
        "cam_t": r(cam_t, 5),
        "focal": r(d["focal_length"].astype(np.float64), 3),
        "valid": d["valid"].astype(bool).tolist(),
    }
    out = os.path.join(OUT_DIR, f"{clip}.s3body3d.json")
    with open(out, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))
    return f"{clip}  {kp3d.shape}  -> {out}  ({os.path.getsize(out) // 1024} KB)"


def main() -> None:
    want = sys.argv[1:]
    files = sorted(glob.glob(os.path.join(NPZ_DIR, "*.npz")))
    if want:
        files = [f for f in files if os.path.basename(f)[:-4] in want]
    if not files:
        print("no matching npz under", NPZ_DIR)
        return
    for f in files:
        print(export(f))
    print(f"\n{len(files)} clip(s) exported to {OUT_DIR}/<clip>.s3body3d.json  (savgol w={SG_WINDOW} p={SG_POLY})")


if __name__ == "__main__":
    main()
