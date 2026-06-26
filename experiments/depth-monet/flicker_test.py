#!/usr/bin/env python
"""Quantify temporal flicker: per-frame Depth Anything V2 vs temporal Video-DA.

Runs DA-V2 (transformers) per frame on the RGB top half, normalizes each frame
within the silhouette, and measures mean frame-to-frame |delta| inside the mask.
Compares against the already-computed Video-DA depth (npz). Lower = steadier.
"""
import argparse, os
import numpy as np
import cv2
import torch
from transformers import pipeline
from PIL import Image


def load_stacked(path):
    cap = cv2.VideoCapture(path)
    rgb, alpha = [], []
    while True:
        ok, f = cap.read()
        if not ok: break
        H = f.shape[0] // 2
        rgb.append(cv2.cvtColor(f[:H], cv2.COLOR_BGR2RGB))
        alpha.append(cv2.cvtColor(f[H:], cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0)
    cap.release()
    return np.stack(rgb), np.stack(alpha)


def norm_in_mask(d, m):
    v = d[m]
    lo, hi = np.percentile(v, 1), np.percentile(v, 99)
    return np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)


def flicker(stack, alpha):
    """mean |frame_t - frame_{t-1}| inside the (intersection) mask, over time."""
    diffs = []
    for t in range(1, len(stack)):
        m = (alpha[t] > 0.5) & (alpha[t - 1] > 0.5)
        if m.sum() == 0: continue
        diffs.append(np.abs(stack[t][m] - stack[t - 1][m]).mean())
    return float(np.mean(diffs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--npz", required=True, help="Video-DA depth npz for same clip")
    args = ap.parse_args()

    rgb, alpha = load_stacked(args.clip)
    T = len(rgb)

    pipe = pipeline("depth-estimation",
                    model="depth-anything/Depth-Anything-V2-Large-hf",
                    device=0)
    perframe = []
    for t in range(T):
        out = pipe(Image.fromarray(rgb[t]))
        d = np.asarray(out["predicted_depth"], np.float32)
        if d.shape != alpha[t].shape:
            d = cv2.resize(d, (alpha[t].shape[1], alpha[t].shape[0]))
        perframe.append(norm_in_mask(d, alpha[t] > 0.5))
    perframe = np.stack(perframe)

    vda = np.load(args.npz)["depth"]
    vda_n = np.stack([norm_in_mask(vda[t], alpha[t] > 0.5) for t in range(T)])

    f_pf = flicker(perframe, alpha)
    f_vda = flicker(vda_n, alpha)
    print(f"\n=== flicker (mean frame-to-frame |Δdepth| in mask, 0..1) ===")
    print(f"  per-frame DA-V2 : {f_pf:.5f}")
    print(f"  temporal Video-DA: {f_vda:.5f}")
    print(f"  Video-DA is {f_pf / max(f_vda,1e-9):.2f}x steadier")


if __name__ == "__main__":
    main()
