#!/usr/bin/env python
"""Offline temporal de-jitter for the SAM-3D-Body per-frame rig.

The rig in out/<clip>.npz is estimated *independently per frame*, so it jitters.
Everything bakes offline, so we have the whole sequence and can apply a zero-phase
(non-causal) filter — cleaner than any realtime/causal model and no GPU.

We smooth in the RIGHT space per signal:
  - rotation matrices (pred_global_rots) -> 6D rep (Zhou et al.) -> filter -> Gram-Schmidt
    back to SO(3). Smoothing raw 3x3 entries would break orthonormality; 6D stays on-manifold.
  - euclidean signals (2D/3D keypoints, joint coords, cam translation) -> filter directly.

Two filters, both zero-phase:
  - savgol : Savitzky-Golay (window W, polyorder P) — preserves peaks/fast motion, kills HF noise.
  - euro   : One-Euro filter run forward+backward (bidirectional) — adaptive, low lag.

Metric (on 2D keypoints, px): mean |p[t-1] - 2p[t] + p[t+1]| = 2nd difference (accel proxy).
Jitter == high-frequency accel; lower is smoother. We also report mean displacement
(how far points moved) so over-smoothing real motion is visible: good = big accel drop,
small displacement.

Usage:
  scripts/.venv/bin/python experiments/sam3d-body/smooth_rig.py <clip> [--method savgol|euro]
                                       [--window 9] [--poly 3] [--mp4]
  (clip = stem, e.g. monet-idle-1; reads experiments/sam3d-body/out/<clip>.npz)
"""
import os, sys, json, argparse
import numpy as np
from scipy.signal import savgol_filter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "experiments/sam3d-body/out")
OUT = os.path.join(ROOT, "experiments/sam3d-body/out_smooth")
VIEWER_DATA = os.path.join(ROOT, "experiments/sam3d-body/viewer/data")
CONTENTS = os.path.join(ROOT, "contents/monet")


# ---------------------------------------------------------------- rotation reps
def mats_to_6d(R):  # (..., 3, 3) -> (..., 6)  first two columns
    return np.concatenate([R[..., :, 0], R[..., :, 1]], axis=-1)


def sixd_to_mats(x):  # (..., 6) -> (..., 3, 3) via Gram-Schmidt
    a1, a2 = x[..., :3], x[..., 3:]
    b1 = a1 / (np.linalg.norm(a1, axis=-1, keepdims=True) + 1e-9)
    a2p = a2 - np.sum(b1 * a2, axis=-1, keepdims=True) * b1
    b2 = a2p / (np.linalg.norm(a2p, axis=-1, keepdims=True) + 1e-9)
    b3 = np.cross(b1, b2)
    return np.stack([b1, b2, b3], axis=-1)  # columns


# ---------------------------------------------------------------- filters (zero-phase)
def smooth_savgol(arr, window, poly):
    """arr (F, ...) -> filter along axis 0. window clamped odd & < F."""
    F = arr.shape[0]
    w = min(window, F if F % 2 else F - 1)
    if w % 2 == 0:
        w -= 1
    if w <= poly or w < 3:
        return arr.copy()
    flat = arr.reshape(F, -1)
    out = savgol_filter(flat, w, poly, axis=0, mode="interp")
    return out.reshape(arr.shape)


def _one_euro_causal(x, dt, min_cutoff, beta, d_cutoff):
    """x (F, D) -> causal One-Euro. Returns filtered (F, D)."""
    F, D = x.shape
    out = np.empty_like(x)
    def alpha(cut):
        tau = 1.0 / (2 * np.pi * cut)
        return 1.0 / (1.0 + tau / dt)
    x_prev = x[0].copy(); dx_prev = np.zeros(D); out[0] = x[0]
    for t in range(1, F):
        dx = (x[t] - x_prev) / dt
        a_d = alpha(d_cutoff)
        dx_hat = a_d * dx + (1 - a_d) * dx_prev
        cut = min_cutoff + beta * np.abs(dx_hat)
        a = alpha(cut)
        out[t] = a * x[t] + (1 - a) * x_prev
        x_prev, dx_prev = out[t], dx_hat
    return out


def smooth_euro(arr, fps, min_cutoff=1.2, beta=0.05, d_cutoff=1.0):
    """Bidirectional One-Euro (forward+backward, averaged) -> zero-phase-ish."""
    F = arr.shape[0]
    dt = 1.0 / fps
    flat = arr.reshape(F, -1).astype(np.float64)
    fwd = _one_euro_causal(flat, dt, min_cutoff, beta, d_cutoff)
    bwd = _one_euro_causal(flat[::-1], dt, min_cutoff, beta, d_cutoff)[::-1]
    return (0.5 * (fwd + bwd)).reshape(arr.shape).astype(arr.dtype)


def apply_filter(arr, method, **kw):
    return smooth_savgol(arr, kw["window"], kw["poly"]) if method == "savgol" \
        else smooth_euro(arr, kw["fps"])


# ---------------------------------------------------------------- gap fill (invalid frames)
def fill_invalid(arr, valid):
    """Linear-interp euclidean arr over invalid frames (axis 0). Edges held."""
    F = arr.shape[0]
    if valid.all():
        return arr.copy()
    idx = np.arange(F)
    good = idx[valid]
    if len(good) == 0:
        return arr.copy()
    flat = arr.reshape(F, -1).copy()
    for c in range(flat.shape[1]):
        flat[:, c] = np.interp(idx, good, flat[good, c])
    return flat.reshape(arr.shape)


# ---------------------------------------------------------------- jitter metric
def accel(kp2d):  # (F,70,2) px -> mean |2nd diff| over valid interior frames
    d2 = kp2d[2:] - 2 * kp2d[1:-1] + kp2d[:-2]
    return float(np.linalg.norm(d2, axis=-1).mean())


def displacement(a, b):  # mean per-kp move (px)
    return float(np.linalg.norm(a - b, axis=-1).mean())


# ---------------------------------------------------------------- main
def process(clip, method, window, poly, want_mp4):
    npz = os.path.join(SRC, clip + ".npz")
    d = dict(np.load(npz))
    F = int(d["frames"]); fps = float(d["fps"]); W = int(d["W"]); H = int(d["H"])
    valid = d["valid"].astype(bool)
    kw = dict(window=window, poly=poly, fps=fps)

    # gap-fill euclidean signals, then filter
    kp2d = fill_invalid(d["pred_keypoints_2d"], valid)
    kp3d = fill_invalid(d["pred_keypoints_3d"], valid)
    jc = fill_invalid(d["pred_joint_coords"], valid)
    cam_t = fill_invalid(d["pred_cam_t"], valid)

    kp2d_s = apply_filter(kp2d, method, **kw)
    kp3d_s = apply_filter(kp3d, method, **kw)
    jc_s = apply_filter(jc, method, **kw)
    cam_t_s = apply_filter(cam_t, method, **kw)

    # rotations: 6D -> filter -> back to SO(3)
    R = fill_invalid(d["pred_global_rots"], valid)          # (F,127,3,3)
    R6 = mats_to_6d(R)                                       # (F,127,6)
    R6_s = apply_filter(R6, method, **kw)
    R_s = sixd_to_mats(R6_s).astype(np.float32)

    # metric
    raw_a = accel(d["pred_keypoints_2d"][valid] if not valid.all() else d["pred_keypoints_2d"])
    sm_a = accel(kp2d_s)
    disp = displacement(d["pred_keypoints_2d"], kp2d_s)
    diag = (W ** 2 + H ** 2) ** 0.5
    print(f"\n[{clip}]  {method}  window={window} poly={poly}  F={F} valid={int(valid.sum())}")
    print(f"  2D-kp jitter (mean |accel|, px):  raw {raw_a:7.3f}  ->  smooth {sm_a:7.3f}"
          f"   ({100*(raw_a-sm_a)/raw_a:5.1f}% lower)")
    print(f"  fidelity (mean displacement):     {disp:7.3f} px  ({100*disp/diag:.2f}% of frame diag)")

    # write smoothed rig (the retargeting deliverable)
    os.makedirs(OUT, exist_ok=True)
    d_out = dict(d)
    d_out.update(pred_keypoints_2d=kp2d_s.astype(np.float32),
                 pred_keypoints_3d=kp3d_s.astype(np.float32),
                 pred_joint_coords=jc_s.astype(np.float32),
                 pred_global_rots=R_s, pred_cam_t=cam_t_s.astype(np.float32),
                 smoothing=np.array(f"{method} w={window} p={poly}"))
    np.savez_compressed(os.path.join(OUT, clip + f".{method}.npz"), **d_out)

    # write raw + smoothed 2D kp (normalized) for the standalone viewer
    os.makedirs(VIEWER_DATA, exist_ok=True)
    def to_json(kp):
        return [[[round(float(x) / W, 5), round(float(y) / H, 5)] for x, y in kp[i]]
                for i in range(F)]
    json.dump({"clip": clip, "fps": fps, "frames": F, "w": W, "h": H,
               "raw": to_json(d["pred_keypoints_2d"]), "smooth": to_json(kp2d_s)},
              open(os.path.join(VIEWER_DATA, clip + f".{method}.json"), "w"),
              separators=(",", ":"))

    if want_mp4:
        render_compare(clip, d["pred_keypoints_2d"], kp2d_s, fps, W, H, method)
    return raw_a, sm_a


# ---------------------------------------------------------------- before/after mp4
SAM_EDGES = [(13,11),(11,9),(14,12),(12,10),(9,10),(5,9),(6,10),(5,6),(5,7),(6,8),
    (7,62),(8,41),(1,2),(0,1),(0,2),(1,3),(2,4),(3,5),(4,6),(13,15),(13,16),(13,17),
    (14,18),(14,19),(14,20),(62,45),(45,44),(44,43),(43,42),(62,49),(49,48),(48,47),
    (47,46),(62,53),(53,52),(52,51),(51,50),(62,57),(57,56),(56,55),(55,54),(62,61),
    (61,60),(60,59),(59,58),(41,24),(24,23),(23,22),(22,21),(41,28),(28,27),(27,26),
    (26,25),(41,32),(32,31),(31,30),(30,29),(41,36),(36,35),(35,34),(34,33),(41,40),
    (40,39),(39,38),(38,37)]


def render_compare(clip, raw, sm, fps, W, H, method):
    import cv2
    src = os.path.join(CONTENTS, clip + ".mp4")
    cap = cv2.VideoCapture(src)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    dst = os.path.join(OUT, clip + f".{method}.compare.mp4")
    vw = cv2.VideoWriter(dst, fourcc, fps, (W * 2, H))

    def draw(img, kp, color):
        for a, b in SAM_EDGES:
            pa, pb = kp[a], kp[b]
            cv2.line(img, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), color, 2, cv2.LINE_AA)
        for p in kp:
            cv2.circle(img, (int(p[0]), int(p[1])), 2, (255, 255, 255), -1, cv2.LINE_AA)

    F = raw.shape[0]
    for i in range(F):
        ok, frame = cap.read()
        if not ok:
            break
        color = frame[:H, :W].copy()          # top half = color
        left, right = color.copy(), color.copy()
        draw(left, raw[i], (60, 60, 255))      # raw = red  (BGR)
        draw(right, sm[i], (60, 255, 60))      # smooth = green
        cv2.putText(left, "RAW", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (60,60,255), 2)
        cv2.putText(right, f"SMOOTH ({method})", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (60,255,60), 2)
        vw.write(np.hstack([left, right]))
    cap.release(); vw.release()
    print(f"  mp4: {os.path.relpath(dst, ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--method", default="savgol", choices=["savgol", "euro"])
    ap.add_argument("--window", type=int, default=9)
    ap.add_argument("--poly", type=int, default=3)
    ap.add_argument("--mp4", action="store_true")
    a = ap.parse_args()
    process(a.clip, a.method, a.window, a.poly, a.mp4)
