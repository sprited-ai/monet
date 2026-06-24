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

## Upscale / deblur (Jin: "뛰는 애니메이션이 블러리")

The fast-motion (walk/run) frames read soft. Diagnosis from `out/run_sequence_orig.png`:
the run frames are **fairly sharp individually** — the softness is mostly **640-res
spatial softness + temporal judder at 16 fps**, not heavy baked-in motion blur.

So the fix is layered (a single per-frame upscaler is *not* the whole answer):

| layer | tool | status | what it fixes |
|---|---|---|---|
| spatial | `RealESRGAN_x4plus_anime_6B` (on gin) | ✅ done | low-res line/edge softness |
| temporal | RIFE/FILM VFI (nodes on gin) | ⚠ ckpt not downloaded (GitHub blocked; pull from HF) | judder on fast motion |
| restore | **SeedVR2** (not installed) | proposed | true temporal deblur+upscale, the dedicated "fix the blur" model |
| root cause | regen w/o 6-step distill LoRA | ✅ **confirmed the main cause** | distill LoRA smeared fast motion; 25-step is visibly sharper |

**E1a — anime upscale (done).** `upscale_scail2.py`: RealESRGAN anime 4× → lanczos to
1280, 32 s on gin. `out/scail2_monet_e1_up_00001.mp4`. Compare on a run frame:
`out/upscale_compare_run_frame.png` (left 640 nearest, right 1280) — clearly crisper
hair/eyes/floral. This frame was low-res, not motion-blurred, so it cleaned up well.
**Honest caveat:** where a frame is genuinely motion-smeared, ESRGAN upscales the smear;
it can't reconstruct it. That's what SeedVR2 / the root-cause regen are for.

**E1b — root-cause regen (the real finding).** Same inputs/seed, **no speed LoRA, 25
steps, cfg 5.0**. 745 s vs 88 s (~8.5×). `out/scail2_monet_e1b_quality_00001.mp4`.
Zoomed leg/shoe compare `out/compare_legs_6vs25.png` (left 6-step, right 25-step): the
25-step is **clearly cleaner** — crisp shoe outline + stripe, distinct floral pattern,
sharp leg contour. **So the run-blur was mostly the 6-step distill LoRA, not the
resolution.** Quality ceiling is much higher than E1 suggested.

**Best result so far = E1b + anime upscale:** `out/scail2_monet_e1b_up_00001.mp4`
(`out/final_25step_upscaled_montage.png`). Sharp source × 1280 anime upscale.

Recipe / cost trade:
- **Hero clips:** 25-step no-LoRA (~12 min/clip) → ESRGAN 1280. Sharpest.
- **Fast/batch:** 6-step distill LoRA (~90 s/clip) → ESRGAN. Softer on fast motion.
- Open: a middle speed LoRA or fewer-but-not-6 steps; RIFE for judder (ckpt blocked on
  GitHub, pull from HF); SeedVR2 for true temporal restore.

```bash
python3 run_scail2.py --ref monet_ref_idle1.png --drive seedance-sample.mp4 \
    --steps 25 --cfg 5.0 --lora_strength 0.0 --prefix scail2_monet_e1b_quality   # sharp source
python3 upscale_scail2.py --video scail2_monet_e1b_quality_00001.mp4 --target 1280 --prefix scail2_monet_e1b_up
python3 rife_scail2.py --video scail2_monet_e1b_up_00001.mp4 --mult 2 --in_fps 16   # judder; needs a RIFE ckpt
```

## E2 — cross-structure: real human → Monet (done ✅ — the decisive test)

Driving video: `birefnet-video-input.mp4` (Jin) — a **real woman in a suit, gesturing
and talking** in a studio (1920×1080, 8 s). Normal adult proportions (~7–8 heads) → the
3-head chibi. Preprocess: center square-crop → 640×640, 16 fps. Same Monet idle reference.

**Result** (`out/e2_human_vs_monet.png` top=human / bottom=Monet; `out/e2_monet_montage.png`):
Monet **follows the human's conversational gestures** — arms spread open → hands coming
together → hands clasped front — identity intact. SCAIL-2 even adapts her into the
driving video's upper-body framing. **This is the thing the skeleton path could never
do**: a real human's motion retargeted onto a chibi with no rig, no pose extraction.

- 6-step: `out/scail2_monet_e2_human_00001.mp4` (92 s). Hands a bit soft (tiny chibi
  hands + fast gesture + speed LoRA).
- 25-step quality: `scail2_monet_e2_human_q` (cleaner; see file).

**Why it matters:** conversational gesture motion is exactly what whiteroom Monet needs
for talk clips. E2 + E5 = the full open-ended path: *any* human performance → Monet clip →
stacked-alpha sprite. The fixed 64-clip library can become an open vocabulary.

## E5 — stacked-alpha integration (done ✅)

Proves the back half: a SCAIL-2 clip → a real transparent Monet sprite. `matte_scail2.py`
runs BiRefNet (General; clean on the white bg) → alpha video (8 s on gin), then ffmpeg
`vstack` color-over-alpha → **`out/scail2_monet_e1b_stacked.mp4`, 640×1280** — *byte-for-byte
the format of a real `contents/monet/*.mp4`* (`docs/008` stacked-alpha). Cutout is clean,
no halo, white socks/light dress preserved (`out/matte_transparency_check.png`).

So the **whole pipeline is proven end-to-end**: drive → generate → quality regen → upscale
→ matte → stacked-alpha. The result could drop into `contents/monet/`, run the `docs/017`
derivative pipeline, and play in `CharacterNode` (`docs/016`) unchanged.

```bash
python3 matte_scail2.py --video scail2_monet_e1b_quality_00001.mp4 --w 640 --h 640 --prefix scail2_monet_e1b_alpha
ffmpeg -i color.mp4 -i alpha.mp4 -filter_complex "[0:v]scale=640:640[c];[1:v]format=gray[a];[c][a]vstack" stacked.mp4
```

## The experiment menu (what's possible with gin + ComfyUI)

Ranked. E1 done; the rest reuse the same runner / environment.

- **E1 — animation smoke test** ✅ *(done)* — Monet→Monet, prove the pipeline + identity.
- **E2 — cross-structure retarget** ✅ *(done)* — drive Monet with a **real human** motion video.
  The hard case SCAIL-2 claims and the skeleton path can't do. The decisive product test.
- **E3 — replacement mode + background** — SAM3 masking: swap a person in a scene for
  Monet, keep the room. Tests the "second entity / user in the white room" future
  (`docs/016` leaves seams). Needs the SAM3.1 checkpoint (not yet downloaded).
- **E4 — fidelity & resolution sweep** — 480 vs 720 vs a 32-multiple near 1024. Measure
  crispness against Monet's 1024–2043 px source and the `docs/016` "never below source"
  rule. Quantifies the one real tension from the study.
- **E5 — stacked-alpha integration** ✅ *(done)* — output → matte (`birefnet-toonout` /
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
