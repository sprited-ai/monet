# De-jittering the SAM-3D-Body rig (for retargeting training data)

**Goal:** the per-frame SAM-3D-Body rig (`out/<clip>.npz`) is near-SOTA on Monet's
keypoints/joints, but it's estimated *independently per frame* → temporal jitter. To use it
as **retargeting training data**, the jitter has to go.

**Question we were really asking:** is `gaomingqi/sam-body4d` (the temporal/4D version) the way
to get temporally-consistent rig? **Answer: no — not needed.** sam-body4d's mesh stage IS
sam-3d-body (same chibi-incompatible MHR), and its added machinery (SAM-3 track + Diffusion-VAS
occlusion recovery) targets failure modes we don't actually hit. Since every derivative bakes
**offline**, we have the whole sequence and can apply a **zero-phase (non-causal) filter** —
cleaner than any realtime/causal model, no GPU, deterministic.

## Method — `smooth_rig.py`

Smooth each signal in the right space, then write a smoothed rig NPZ:
- **rotations** (`pred_global_rots`, F×127×3×3): matrix → **6D rep** (Zhou et al., first two
  columns) → filter → **Gram-Schmidt** back to SO(3). (Filtering raw 3×3 entries would break
  orthonormality; 6D stays on-manifold.)
- **euclidean** (`pred_keypoints_2d/3d`, `pred_joint_coords`, `pred_cam_t`): filter directly.
- **invalid frames**: linear-interpolated (`fill_invalid`) before filtering.

Two zero-phase filters:
- `savgol` — Savitzky-Golay (window W, polyorder P). Preserves peaks/fast motion, kills HF noise.
  **Default W=9 P=3.** (W=13 smooths idle harder with no real-motion penalty.)
- `euro` — One-Euro run forward+backward (averaged). Adaptive; slightly less reduction here.

**Metric** (on 2D keypoints, px): mean `|p[t-1] − 2p[t] + p[t+1]|` = 2nd difference
(acceleration proxy). Jitter == high-freq accel; lower is smoother. We also report mean
**displacement** (how far points moved from raw) — over-smoothing real motion shows up as a big
displacement. Good = big accel drop, small displacement.

## Results

Batch over all 64 clips, `savgol w9 p3`:

| | mean | median | range |
|---|---|---|---|
| raw jitter (accel px) | 9.85 | 7.29 | … 49.91 |
| smoothed jitter | 3.55 | 2.57 | … 15.10 |
| **reduction** | **64.8%** | **67.6%** | **40.7 – 81.4%** (every clip) |

Per-class spot checks (displacement = mean px moved from raw, % of frame diagonal):
- **idle** (low motion): 78% jitter ↓, displacement 0.67px (0.07%) — jitter was pure noise.
- **jumping-jacks / dance / jump** (high motion): 40–52% ↓, ~3px (0.3%) — residual is *real*
  fast acceleration, correctly preserved; body motion not flattened.
- **back-to-front / turn** (the worst case for naive smoothing — a per-frame pose *flip* would
  get averaged into garbage): 55–68% ↓, up to 9.6px (1.0%). Frame-by-frame review
  (`out_smooth/*.compare.mp4`, frames across the turn) shows the per-frame fit is robust through
  the turn — **no catastrophic flip**, the 9.6px is genuine large rotation that smoothing tracks.

**Verdict:** offline zero-phase filtering alone makes the rig retarget-ready. The one scenario
where sam-body4d could beat it (pose-flip during occlusion/turn) does **not** materialize on
Monet's clips. Don't set up sam-body4d.

## Run

```bash
V=scripts/.venv/bin/python   # has numpy+scipy+cv2; no GPU needed
# one clip + before/after side-by-side mp4 (raw=red, smooth=green, over color frame):
$V experiments/sam3d-body/smooth_rig.py monet-idle-1 --method savgol --window 9 --poly 3 --mp4
# all clips (deliverable: out_smooth/<clip>.savgol.npz = de-jittered rig):
for f in experiments/sam3d-body/out/*.npz; do
  $V experiments/sam3d-body/smooth_rig.py "$(basename "$f" .npz)" --method savgol --window 9 --poly 3
done
```

## Outputs
- `out_smooth/<clip>.savgol.npz` — full de-jittered rig (same schema as `out/`, smoothed
  `pred_keypoints_2d/3d`, `pred_joint_coords`, `pred_global_rots`, `pred_cam_t`). **This is the
  retargeting training data.**
- `out_smooth/<clip>.savgol.compare.mp4` — raw|smooth side-by-side overlay (with `--mp4`).
- `viewer/data/<clip>.savgol.json` — raw+smooth 2D kp (normalized) for an overlay viewer.

## Open follow-ups
- Smoothing is on **global** joint rotations. For cleanest retargeting, smooth in **local**
  (parent-relative) space — needs the MHR skeleton hierarchy (not in the NPZ; pull from
  `sam_3d_body.metadata`).
- Per-clip window tuning (idle wants W=13; fast clips W=7–9). A motion-adaptive window or just
  `euro` could auto-handle this; current default W=9 is a safe middle.
