#!/usr/bin/env python
"""From a depth npz, derive what the 'stick a thrown object' use case needs:

  - surface NORMAL map (depth gradient -> orientation a stuck object lies along)
  - a Lambert RELIGHT (proves the depth is coherent form, not noise)
  - a SYNTHETIC depth-from-alpha baseline (distance transform 'balloon') + its
    normal, to compare ML depth vs the GPU-free shortcut

Outputs a montage mp4:  RGB | ML-depth | ML-normal | ML-relit | synth-depth | synth-normal
and a single comparison PNG at the chosen frame.
"""
import argparse, os
import numpy as np
import cv2


def normals_from_depth(depth, alpha, z_scale):
    """Surface normals from a depth map. z_scale trades bump strength
    (higher = flatter / more camera-facing). Gradients in normalized depth
    units per pixel are tiny, so we lift them by z_scale before the cross."""
    d = cv2.GaussianBlur(depth.astype(np.float32), (0, 0), 3.0)
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=5, scale=1 / 16)
    gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=5, scale=1 / 16)
    # nearer = larger depth; screen +x right, +y down. normal points to camera.
    n = np.dstack([-gx * z_scale, -gy * z_scale, np.ones_like(d)])
    nlen = np.linalg.norm(n, axis=2, keepdims=True)
    n = n / np.clip(nlen, 1e-6, None)
    rgb = ((n * 0.5 + 0.5) * 255).astype(np.uint8)
    rgb[alpha <= 0.5] = 0
    return n, rgb


def relight(rgb, n, alpha, light_dir):
    L = np.asarray(light_dir, np.float32); L /= np.linalg.norm(L)
    ndl = np.clip((n * L).sum(2), 0, 1)
    shade = (0.35 + 0.65 * ndl)[..., None]
    out = (rgb.astype(np.float32) * shade).clip(0, 255).astype(np.uint8)
    out[alpha <= 0.5] = 0
    return out


def synth_depth_from_alpha(alpha):
    """GPU-free 'balloon' pseudo-depth: distance-to-edge inside the silhouette,
    softened. Captures silhouette bulge, NOT internal pose (flat arms)."""
    m = (alpha > 0.5).astype(np.uint8)
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    if dt.max() > 0:
        dt = dt / dt.max()
    bulge = np.sqrt(np.clip(dt, 0, 1))  # rounder falloff
    return (bulge * m).astype(np.float32)


def gray3(x01, alpha):
    g = (np.clip(x01, 0, 1) * 255).astype(np.uint8) * (alpha > 0.5)
    return cv2.cvtColor(g.astype(np.uint8), cv2.COLOR_GRAY2BGR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("npz")
    ap.add_argument("--rgbclip", required=True, help="source stacked clip for RGB top half")
    ap.add_argument("--out", default=".")
    ap.add_argument("--frame", type=int, default=60)
    ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--zscale", type=float, default=40.0)
    args = ap.parse_args()
    name = os.path.splitext(os.path.basename(args.npz))[0].replace("_depth", "")

    z = np.load(args.npz)
    depth, alpha = z["depth"], z["alpha"]
    T, H, W = depth.shape

    # per-frame normalize ML depth within silhouette
    cap = cv2.VideoCapture(args.rgbclip)
    rgb_frames = []
    while True:
        ok, f = cap.read()
        if not ok: break
        rgb_frames.append(f[:f.shape[0] // 2])  # BGR top half
    cap.release()

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    vw = cv2.VideoWriter(os.path.join(args.out, f"{name}_stickdemo.mp4"),
                         fourcc, args.fps, (W * 6, H))
    png_done = False
    for t in range(T):
        a = alpha[t]
        d = depth[t]
        m = a > 0.5
        if m.sum() == 0:
            continue
        lo, hi = np.percentile(d[m], 1), np.percentile(d[m], 99)
        dn = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)

        _, ml_n_rgb = normals_from_depth(dn, a, args.zscale)
        n_ml, _ = normals_from_depth(dn, a, args.zscale)
        bgr = rgb_frames[t] if t < len(rgb_frames) else np.zeros((H, W, 3), np.uint8)
        relit = relight(bgr, n_ml, a, [0.6, -0.5, 0.6])

        sd = synth_depth_from_alpha(a)
        _, sd_n_rgb = normals_from_depth(sd, a, args.zscale * 0.5)

        row = np.hstack([
            bgr,
            gray3(dn, a),
            cv2.cvtColor(ml_n_rgb, cv2.COLOR_RGB2BGR),
            relit,
            gray3(sd, a),
            cv2.cvtColor(sd_n_rgb, cv2.COLOR_RGB2BGR),
        ])
        vw.write(row)
        if t == args.frame and not png_done:
            cv2.imwrite(os.path.join(args.out, f"{name}_compare.png"), row)
            png_done = True
    vw.release()
    print(f"saved {name}_stickdemo.mp4 + {name}_compare.png  "
          f"(cols: RGB | ML-depth | ML-normal | ML-relit | synth-depth | synth-normal)")


if __name__ == "__main__":
    main()
