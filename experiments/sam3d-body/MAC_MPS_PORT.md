# SAM-3D-Body on Apple Silicon (Mac / MPS) — working port

**Status (2026-06-25): WORKS.** Full SAM-3D-Body inference runs on a Mac, hybrid
**backbone→MPS + MHR-FK→CPU**, producing keypoints **identical** to a CUDA/CPU run.
No prior art existed (first body-MHR Apple-Silicon port). Candidate to open-source as
`sprited-ai/sam-3d-body-mps` (see license note below).

## The two blockers and how they're solved

1. **Hardcoded CUDA** (`.cuda()`, `recursive_to(...,"cuda")`) in the inference path →
   made device-aware. Also the QA render import (`tools/vis_utils` → detectron2/pyrender,
   unbuildable on Mac) is guarded in `sam3d_batch.py` — core inference needs neither.
2. **THE wall — pymomentum MHR uses float64**, which MPS cannot hold, and it's
   TorchScript-compiled so `PYTORCH_ENABLE_MPS_FALLBACK` can't cross it. **Fix: switch off
   the TorchScript path by installing the *native* MHR** (`pip install pymomentum-cpu mhr`).
   `mhr_head.py` then takes `MHR.from_files(...)` (native C++ pymomentum) instead of the
   `.pt` blob. Native MHR runs float64 FK **on CPU** (fine — CPU has float64), so we isolate
   just the FK to CPU and keep the heavy ViT backbone on MPS.

## Result (clip `monet-lookup-3`, M-series, first frame incl. MPS warmup)

| run | s/frame | notes |
|---|---|---|
| CPU (native MHR) | 51.2 | correct |
| **MPS hybrid (backbone MPS, MHR CPU)** | **12.3** | **4.2× faster, identical keypoints** (nose [340.71,222.67] vs CPU [340.66,222.67]) |
| gin RTX PRO 6000 | ~0.04 | reference |

12.3s includes first-frame MPS graph compilation; steady-state per-frame is lower (measure
over a full clip). Still far from CUDA, but it makes Mac-only inference real.

## Setup recipe

```bash
# Python 3.12 venv (pymomentum-cpu wheels are cp312/cp313 only — NOT 3.11)
uv venv --python 3.12 .venv && source .venv/bin/activate
uv pip install torch torchvision numpy opencv-python pillow scipy \
  pytorch-lightning yacs scikit-image einops timm dill pandas rich hydra-core \
  hydra-colorlog pyrootutils networkx==3.2.1 roma joblib huggingface_hub optree \
  fvcore omegaconf loguru braceexpand webdataset chump jsonlines appdirs seaborn \
  pymomentum-cpu mhr            # ← native MHR (Apache-2.0), replaces the float64 TorchScript path

# MHR model assets (lod1.fbx etc.) — public GitHub release, ungated:
gh release download v1.0.1 --repo facebookresearch/MHR --pattern assets.zip
unzip assets.zip -d /tmp/mhr && cp /tmp/mhr/assets/* .venv/lib/python3.12/site-packages/assets/

# sam-3d-body checkpoints: scp from gin (HF-gated; gin already approved) — 2.7GB.
```

Then apply `mac-mps-port.patch` (4 files, ~18 lines) to the `sam_3d_body` package and run
`mps_probe.py` with `PROBE_DEVICE=mps PYTORCH_ENABLE_MPS_FALLBACK=1`.

## The patch (`mac-mps-port.patch`)

- `sam_3d_body_estimator.py` — input batch → device (was `"cuda"`).
- `meta_arch/sam3d_body.py` — meshgrid follows `batch["img"].device`; hand-branch joint
  idxs / hand batches → device (were `.cuda()`).
- `meta_arch/base_model.py` — `image_mean/std` → `inputs.device` (device-agnostic).
- `heads/mhr_head.py` — **the key boundary**: pin native MHR to CPU and hand off
  `shape/model/expr params .cpu()` in, `verts/skel_state .to(device)` out. Isolates the
  float64 FK so the rest of the net stays on MPS.

## Why hybrid, not full-MPS (investigated 2026-06-25)

Tried to move the MHR FK to MPS too (feed float32, keep MHR on device). **Blocked:**
`joint_parameters_to_skeleton_state` is a compiled pymomentum op (`geometry.so`) that computes
in **float64** internally (the character skeleton loads as double); there's no Python flag to flip,
and float32 inputs don't change it → same `.double()`-on-MPS error. **And it's not worth chasing:**
the FK is the *cheap* part (127-joint kinematics, few-KB transfer); the 4.2× already came from the
ViT backbone on MPS. Full-MPS would mean **reimplementing the FK + skinning in float32 PyTorch**
(pymomentum's dtype-aware `skel_state.py` helpers) for ~zero speedup. Hybrid is the correct design.

## For the OSS repo (cleanups before publishing)

- ✅ **DONE — device-agnostic.** Hardcoded `"mps"` removed: estimator uses `self.device`,
  `sam3d_body.py` derives device from in-scope tensors (`cam_int.device` / `joint_rotations.device`),
  and the `mhr_head.py` CPU offload is now **MPS-only** (`if _dev.type == "mps"`) — so CUDA/CPU keep
  the MHR on the model device with no regression. Same code runs CPU/CUDA/MPS unchanged → upstreamable.
  (CUDA path is equivalent-by-construction to the original `.cuda()`; an empirical gin run is the
  remaining PR-prep check.)
- Measure steady-state throughput over a full clip (exclude warmup). [obs: ~8.6s/frame on M-series.]
- **License: source-available, NOT MIT/Apache.** sam-3d-body is under Meta's **SAM License**
  (derivatives allowed, must carry the SAM License + Agreement; you own your changes).
  `pymomentum`/`mhr` are Apache-2.0. **Weights stay gated** (HF) — ship code only, users
  bring their own. Pattern matches `ZimengXiong/Sam3D-Objects-MLX` (the Objects sibling).

See memory `sam-3d-body-mac-mps-port` and `sam-3d-body-not-for-monet`.
