# 017 — Clip sidecar data pipeline

How to (re)generate the per-frame data that rides alongside each Monet clip. Every
`contents/monet/<clip>.mp4` (stacked-alpha: color top / alpha-as-luma bottom) has
**sidecar JSON** the renderer fetches:

| sidecar | from | drives | where it runs |
|---|---|---|---|
| `<clip>.pose.json` | **bizarre-pose-estimator** (2D) | contact-shadow x (`com`), camera zoom (`face`), x-ray **B** | local CPU |
| `<clip>.s3body.json` | **SAM-3D-Body** (3D rig) | x-ray **A** (70-kp rig + hands); future chibi retarget | **gin** GPU → local |
| `<clip>.mouth.json` | SAM3 mouth track | shader mouth-erase / contour | separate track (not covered here) |

All sidecar coords are normalized 0..1 to the **color (top-half) frame**, so they map
straight onto the sprite via the same inverse-shader transform in the UI.

Both generators are **resume-friendly**: re-running only processes clips whose output
doesn't exist yet. So the standard flow is: **drop new `.mp4`s in `contents/monet/`,
run both, commit.**

> Automation TODO: this is documented-but-manual for now (per Jin — keep it simple,
> wrap it later). A one-shot `regen-sidecars` wrapper is the obvious next step.

---

## 1. Bizarre → `pose.json` (local, CPU)

Env: the repo venv `scripts/.venv` with detectron2 etc. (see
`experiments/bizarre-pose-estimator/RUN_NOTES.md`). The estimator dir is a vendored
clone (gitignored except our `_scripts/*` + `RUN_NOTES.md`).

```bash
cd experiments/bizarre-pose-estimator
TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 ../../scripts/.venv/bin/python -m _scripts.pose_data \
    ../../contents/monet --glob '../../contents/monet/*.mp4'
```

- Writes `contents/monet/<clip>.pose.json` (skips ones that exist).
- ~2 min/clip on CPU (pose model is CPU-only). For many new clips, run 4 workers by
  splitting the file list and setting `POSE_THREADS=2` per worker (see how the full
  batch was run in git history / RUN_NOTES).
- Schema: per frame `{ bbox, com, face, kp:[[x,y,score]…] }`. `com`/`face` are
  mask-derived (robust); raw keypoints are noisy on the chibi.

## 2. SAM-3D-Body → `s3body.json` (gin GPU, 4 steps)

The heavy rig (`experiments/sam3d-body/out/<clip>.npz`) is the source of truth; the
slim browser JSON is exported from it. gin env at `~/dev/sam-3d-body` (uv venv, torch
cu128 for Blackwell, detectron2, dinov3 ckpt — built by `gin/setup_gin.sh`, see memory
`sam-3d-body-not-for-monet` + `experiments/sam3d-body/README.md`).

```bash
# from repo root. NOTE the remote path is `gin:dev/...` (a literal `~/` does NOT expand
# through rsync's quoting — that bit me).

# (1) push new clips up
rsync -a contents/monet/*.mp4 gin:dev/sam-3d-body/monet_clips/

# (2) run the rig batch on gin (resumable — only new clips). Detached + log:
ssh gin 'cd ~/dev/sam-3d-body && rm -f batch.log && setsid bash run_batch.sh > batch.log 2>&1 < /dev/null & echo launched'
#     watch:  ssh gin 'tail -f ~/dev/sam-3d-body/batch.log'   (~30 s/clip on the GPU)
#     (stdout is buffered to the file; the real progress signal is sam3d_out/*.npz appearing)

# (3) pull the NPZs (+ QA renders) back
rsync -a gin:dev/sam-3d-body/sam3d_out/ experiments/sam3d-body/out/

# (4) export the slim per-frame 70-keypoint JSON the browser fetches
scripts/.venv/bin/python experiments/sam3d-body/export_s3body_json.py
```

- (2) writes `sam3d_out/<clip>.npz` (skips existing) + `sam3d_out/renders/<clip>.jpg`.
- (4) writes `contents/monet/<clip>.s3body.json` (regenerates all — cheap; ~0.1 s/clip).
- The detector can't see the chibi, so the batch bypasses it with an **alpha-derived
  per-frame bbox** — that's why it fits every frame (valid 121/121).
- Full NPZ schema + the 70-keypoint index map: `experiments/sam3d-body/README.md`.

## 3. Commit

```bash
git add contents/monet/*.pose.json contents/monet/*.s3body.json
git commit -m "contents: sidecars for <new clips>"
git push
```

Committed: the `.mp4`, `.pose.json`, `.s3body.json` (browser-facing). **Not** committed:
`experiments/sam3d-body/out/*.npz` (~0.85 MB/clip, gitignored — regenerable on gin and
synced there). Prod serves `contents/` from R2; `npm run sync:contents` pushes new
sidecars to the bucket so the deployed `/preview` sees them.

## Gotchas (learned the hard way)

- **rsync `~`**: use `gin:dev/sam-3d-body/...`, not `gin:'~/dev/...'` — the tilde
  doesn't expand and rsync silently copies nothing.
- **buffered logs**: a detached python writing to a file buffers stdout; don't trust an
  empty/short log — check the output files (`*.npz`, `*.pose.json`) for real progress.
- **conda ToS / Python.h**: gin uses `uv` (not conda) and a uv-managed Python so the
  detectron2 C++ build finds headers. `setup_gin.sh` captures the working recipe.
- **per-clip thread cap** (bizarre): set `POSE_THREADS` so parallel workers don't
  oversubscribe the cores.
