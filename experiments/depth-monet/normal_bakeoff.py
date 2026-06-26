#!/usr/bin/env python
"""Normal-map bake-off on a Monet frame (runs on gin).

Compares, for one frame:
  - depth-derived  (gradient of the Video-DA depth we already store)
  - NormalBae      (controlnet_aux, feedforward dedicated normal)
  - Marigold-Normals (diffusers, SOTA diffusion normal)

Question: does a dedicated normal model recover surface detail (dress folds, hair,
face relief) that the smooth depth flattens away — on a stylized anime chibi? And
how do they differ from the depth-consistent normal we'd get for free.

Out: <name>_normal_bakeoff.png  (RGB | depth-derived | NormalBae | Marigold), masked.
"""
import argparse, os, sys
import numpy as np
import cv2

# controlnet_aux pulls mediapipe->tensorflow (broken here); we don't use those.
from unittest.mock import MagicMock
sys.modules['mediapipe'] = MagicMock()


def depth_derived_normal(depth, alpha, z_scale=8.0):
    d = cv2.GaussianBlur(depth.astype(np.float32), (0, 0), 3.0)
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=5, scale=1 / 16)
    gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=5, scale=1 / 16)
    n = np.dstack([-gx * z_scale, -gy * z_scale, np.ones_like(d)])
    n /= np.clip(np.linalg.norm(n, axis=2, keepdims=True), 1e-6, None)
    rgb = ((n * 0.5 + 0.5) * 255).astype(np.uint8)
    rgb[alpha <= 0.5] = 0
    return rgb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("npz")
    ap.add_argument("--rgbclip", required=True)
    ap.add_argument("--out", default=".")
    ap.add_argument("--frame", type=int, default=60)
    args = ap.parse_args()
    name = os.path.splitext(os.path.basename(args.npz))[0].replace("_depth", "")

    z = np.load(args.npz)
    depth, alpha = z["depth"][args.frame], z["alpha"][args.frame]
    H, W = alpha.shape
    m = alpha > 0.5
    dn = depth.copy()
    lo, hi = np.percentile(dn[m], 1), np.percentile(dn[m], 99)
    dn = np.clip((dn - lo) / max(hi - lo, 1e-6), 0, 1)

    cap = cv2.VideoCapture(args.rgbclip)
    bgr = None
    for _ in range(args.frame + 1):
        ok, f = cap.read()
        if not ok: break
        bgr = f[:f.shape[0] // 2]
    cap.release()
    rgb_img = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    from PIL import Image
    pil = Image.fromarray(rgb_img)

    cols = {"RGB": bgr, "depth-derived": cv2.cvtColor(depth_derived_normal(dn, alpha), cv2.COLOR_RGB2BGR)}

    # NormalBae
    try:
        from controlnet_aux import NormalBaeDetector
        det = NormalBaeDetector.from_pretrained("lllyasviel/Annotators").to("cuda")
        out = det(pil, output_type="np")  # HxWx3 uint8 normal viz
        out = cv2.resize(out, (W, H))
        out[~m] = 0
        cols["NormalBae"] = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
        print("NormalBae ok")
    except Exception as e:
        print("NormalBae FAILED:", repr(e)[:200])

    # Marigold-Normals
    try:
        import torch
        from diffusers import MarigoldNormalsPipeline
        pipe = MarigoldNormalsPipeline.from_pretrained(
            "prs-eth/marigold-normals-v1-1", variant="fp16", torch_dtype=torch.float16).to("cuda")
        res = pipe(pil)
        vis = pipe.image_processor.visualize_normals(res.prediction)[0]  # PIL
        out = cv2.resize(np.array(vis), (W, H))
        out[~m] = 0
        cols["Marigold"] = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
        print("Marigold ok")
    except Exception as e:
        print("Marigold FAILED:", repr(e)[:200])

    montage = np.hstack(list(cols.values()))
    path = os.path.join(args.out, f"{name}_normal_bakeoff.png")
    cv2.imwrite(path, montage)
    print("saved", path, "cols:", list(cols.keys()))


if __name__ == "__main__":
    main()
