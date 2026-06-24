# scail2-monet — SCAIL-2 motion transfer for Monet

**Question:** can [SCAIL-2](https://huggingface.co/zai-org/SCAIL-2) (skeleton-free
character animation, Wan2.1-14B base) drive **Monet** — the 3-head chibi that the
human-skeleton path can't even detect (`memory: sam-3d-body-not-for-monet`)?

**Status: E1 ran. ✅ It works.** SCAIL-2 retargets motion onto a Monet reference and
keeps her on-model. See `out/`.

Environment: gin (`RTX PRO 6000 Blackwell, 96 GB`), its ComfyUI **v0.24.1**
(= `comfy.sprited.ai`, localhost:8188). Everything ran there; this folder holds the
runner, inputs, and visible outputs.

---

## What ran — E1: animation-mode smoke test

Drive a **Monet reference still** with a **Monet motion clip**, single character, no
masking. Same-character driving on purpose: it isolates "does the pipeline produce a
coherent, on-model animated Monet?" from the harder cross-structure question (E2).

| | |
|---|---|
| reference | `inputs/monet_ref_idle1.png` — frame 0 of `monet-idle-1`, color×alpha flattened on white (640×640) |
| driving | `seedance-sample.mp4` (already a Monet clip: idle→wave→walk, 640×640) |
| output | `out/scail2_monet_e1_00001.mp4` — 640×640, 81 frames, 16 fps |
| time | **88 s** on the Blackwell (6-step lightx2v distill, cfg 1.0) |

**Result** (`out/out_montage.png`): the idle reference performs the driving motion —
standing → waving → standing → walking — identity intact (blonde hair, red bow, floral
dress, gray shoes). Reference pose ≠ first output frame, so it's genuinely re-animating,
not echoing the driving video.

### Reading of the result
- **Pipeline works end-to-end** on the chibi. No detector, no skeleton, no rig — the
  exact wall `sam-3d-body` hit is gone.
- **Identity holds** across the clip at this resolution.
- **Caveat — this is the easy case.** Same-character driving (Monet→Monet). The real
  product question is cross-structure (human→Monet) and fidelity at her source res. See
  E2/E4 below.
- **Output is opaque RGB** (white bg) → still needs the matte→stacked-alpha step (E5)
  before it's a usable sprite.

---

## The runner

`run_scail2.py` (runs on gin, talks to ComfyUI at 127.0.0.1:8188). Builds the
`WanSCAILToVideo` graph and submits via the API — parameterised, reusable for E2/E4.

```bash
# on gin, from ~/dev/ComfyUI
python3 run_scail2.py --ref monet_ref_idle1.png --drive seedance-sample.mp4 \
    --w 640 --h 640 --length 81 --steps 6 --prefix scail2_monet_e1
```

Graph (animation mode — **no SAM3 / no colored-mask** in v0.24.1; those are
Replacement-mode only): `UNETLoader(SCAIL-2 fp8) → LoraLoaderModelOnly(lightx2v) →
ModelSamplingSD3` · `CLIPLoader(umt5, type=wan) → CLIPTextEncode` ·
`CLIPVisionLoader(clip_vision_h) → CLIPVisionEncode(ref)` · `VAELoader(wan_2.1_vae)` ·
`VHS_LoadVideo(driving) → pose_video` → **`WanSCAILToVideo`** → `KSampler(euler/simple,
6 steps, cfg 1.0) → VAEDecode → VHS_VideoCombine`.

Models (all already on gin except the first, which this experiment downloaded —
17.7 GB, `Comfy-Org/SCAIL-2`):
`diffusion_models/wan2.1_14B_SCAIL_2_fp8_scaled.safetensors`,
`loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors`,
`text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`,
`clip_vision/clip_vision_h.safetensors`, `vae/wan_2.1_vae.safetensors`.

---

## The experiment menu (what's possible with gin + ComfyUI)

Ranked. E1 done; the rest reuse the same runner / environment.

- **E1 — animation smoke test** ✅ *(done)* — Monet→Monet, prove the pipeline + identity.
- **E2 — cross-structure retarget** — drive Monet with a **real human** motion video.
  The hard case SCAIL-2 claims and the skeleton path can't do. The decisive product test.
- **E3 — replacement mode + background** — SAM3 masking: swap a person in a scene for
  Monet, keep the room. Tests the "second entity / user in the white room" future
  (`docs/016` leaves seams). Needs the SAM3.1 checkpoint (not yet downloaded).
- **E4 — fidelity & resolution sweep** — 480 vs 720 vs a 32-multiple near 1024. Measure
  crispness against Monet's 1024–2043 px source and the `docs/016` "never below source"
  rule. Quantifies the one real tension from the study.
- **E5 — stacked-alpha integration** — output → matte (`birefnet-toonout` /
  `anime-segmentation` on gin) → `docs/008` stacked-alpha → drop into `CharacterNode`.
  The guaranteed-needed back half.
- **E6 — motion-library expansion** — batch new idle/cozy/talk clips from a driving set
  → `docs/017` derivative pipeline → playable. The actual product payoff: an open-ended
  body, not a fixed 64-clip library.

## Files
```
run_scail2.py                       the ComfyUI API runner (reusable)
inputs/monet_ref_idle1.png          E1 reference still (clean Monet on white)
inputs/drive_preview.png            4 frames of the driving clip (idle→wave→walk)
out/scail2_monet_e1_00001.mp4       E1 result (640×640×81, 16fps)
out/out_montage.png                 6 frames of the result — the headline
```
