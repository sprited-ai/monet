#!/usr/bin/env python
"""Surface-following liquid spread PoC on a depth map (runs on gin).

Drop a liquid at a point on the character; it spreads outward by GEODESIC
distance over the depth-lifted surface (a 2.5D height field), not by flat screen
distance. So it follows the body around depth gaps instead of jumping across
them. Renders the front growing over time on a frozen frame.

geodesic = Dijkstra on the 8-connected silhouette graph, edge weight =
sqrt(dx^2 + dy^2 + (z_sep * Δdepth_norm)^2).
"""
import argparse, os
import numpy as np
import cv2
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra


def normals_from_depth(depth, alpha, z_scale=8.0):
    d = cv2.GaussianBlur(depth.astype(np.float32), (0, 0), 3.0)
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=5, scale=1 / 16)
    gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=5, scale=1 / 16)
    n = np.dstack([-gx * z_scale, -gy * z_scale, np.ones_like(d)])
    n /= np.clip(np.linalg.norm(n, axis=2, keepdims=True), 1e-6, None)
    return n


def build_geodesic(depth_n, mask, z_sep):
    """Dijkstra geodesic distance image from a seed, over the masked height field."""
    H, W = mask.shape
    idx = -np.ones((H, W), np.int64)
    ys, xs = np.where(mask)
    idx[ys, xs] = np.arange(len(ys))
    N = len(ys)
    z = depth_n * z_sep
    rows, cols, w = [], [], []
    # 8-neighborhood
    for dy, dx in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
        y2, x2 = ys + dy, xs + dx
        ok = (y2 >= 0) & (y2 < H) & (x2 >= 0) & (x2 < W)
        ok &= mask[np.clip(y2,0,H-1), np.clip(x2,0,W-1)]
        a = idx[ys[ok], xs[ok]]
        b = idx[y2[ok], x2[ok]]
        dz = z[ys[ok], xs[ok]] - z[y2[ok], x2[ok]]
        dist = np.sqrt(dx*dx + dy*dy + dz*dz)
        rows.append(a); cols.append(b); w.append(dist)
    rows = np.concatenate(rows); cols = np.concatenate(cols); w = np.concatenate(w)
    g = csr_matrix((w, (rows, cols)), shape=(N, N))
    return idx, ys, xs, g, N


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("npz")
    ap.add_argument("--rgbclip", required=True)
    ap.add_argument("--out", default=".")
    ap.add_argument("--frame", type=int, default=60)
    ap.add_argument("--seed", type=float, nargs=2, default=None, help="x y in 0..1")
    ap.add_argument("--zsep", type=float, default=300.0)
    ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--color", type=float, nargs=3, default=[40, 120, 255])  # BGR amber liquid
    args = ap.parse_args()
    name = os.path.splitext(os.path.basename(args.npz))[0].replace("_depth", "")

    z = np.load(args.npz)
    depth, alpha = z["depth"][args.frame], z["alpha"][args.frame]
    H, W = alpha.shape
    mask = alpha > 0.5
    dn = depth.copy()
    v = dn[mask]; lo, hi = np.percentile(v, 1), np.percentile(v, 99)
    dn = np.clip((dn - lo) / max(hi - lo, 1e-6), 0, 1)

    cap = cv2.VideoCapture(args.rgbclip)
    rgb = None
    for i in range(args.frame + 1):
        ok, f = cap.read()
        if not ok: break
        rgb = f[:f.shape[0] // 2]
    cap.release()

    n = normals_from_depth(dn, alpha)

    # seed: given, else upper-chest centroid
    if args.seed:
        sx, sy = int(args.seed[0] * W), int(args.seed[1] * H)
    else:
        ys0, xs0 = np.where(mask)
        sx = int(xs0.mean()); sy = int(np.percentile(ys0, 35))
        if not mask[sy, sx]:
            d = (xs0 - sx) ** 2 + (ys0 - sy) ** 2
            k = d.argmin(); sx, sy = xs0[k], ys0[k]

    idx, ys, xs, g, N = build_geodesic(dn, mask, args.zsep)
    src = idx[sy, sx]
    geod = dijkstra(g, directed=False, indices=src)
    gimg = np.full((H, W), np.inf, np.float32)
    gimg[ys, xs] = geod
    reach = np.isfinite(gimg)
    gmax = np.percentile(gimg[reach], 99)

    # gravity sheen direction (down-ish on the body)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    n_t = 72
    vw = cv2.VideoWriter(os.path.join(args.out, f"{name}_liquid_spread.mp4"),
                         fourcc, args.fps, (W, H))
    col = np.array(args.color, np.float32)
    for t in range(n_t):
        front = (t / (n_t - 1)) ** 0.85 * gmax * 1.05
        wet = reach & (gimg <= front)
        edge = wet & (gimg > front - 14)  # bright meniscus at the leading edge
        # normal-based sheen on wet area
        L = np.array([0.5, -0.6, 0.6]); L /= np.linalg.norm(L)
        spec = np.clip((n * L).sum(2), 0, 1) ** 6
        out = rgb.astype(np.float32).copy()
        wet3 = wet[..., None]
        out = np.where(wet3, out * 0.45 + col * 0.55, out)
        out += (spec * 160)[..., None] * wet3
        out = np.where(edge[..., None], np.minimum(out + 90, 255), out)
        out[~mask] = 0
        cv2.circle(out, (sx, sy), 4, (255, 255, 255), -1)
        vw.write(out.clip(0, 255).astype(np.uint8))
    vw.release()
    # also a 3-up still: drop / mid / full
    stills = []
    for frac in (0.12, 0.45, 1.0):
        wet = reach & (gimg <= frac * gmax * 1.05)
        o = rgb.astype(np.float32).copy()
        o = np.where(wet[..., None], o * 0.45 + col * 0.55, o)
        o[~mask] = 0
        cv2.circle(o, (sx, sy), 4, (255,255,255), -1)
        stills.append(o.clip(0,255).astype(np.uint8))
    cv2.imwrite(os.path.join(args.out, f"{name}_spread_steps.png"), np.hstack(stills))
    print(f"saved {name}_liquid_spread.mp4 + {name}_spread_steps.png  seed=({sx},{sy})")


if __name__ == "__main__":
    main()
