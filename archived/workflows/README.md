# Monet ComfyUI workflows (gin · local LTX/Wan generation)

Starter i2v workflows for the **free, local** generation path on `gin`
(RTX PRO 6000 Blackwell 96GB, ComfyUI 0.24.1). This is the scale answer to fal's
per-clip cost — marginal cost ≈ $0. See `BACKLOG.md` → Content/GTM.

## Where they live
- **On gin (edit here in the UI):** `~/dev/ComfyUI/user/default/workflows/monet/`
  → open in ComfyUI (browser: `comfy.sprited.ai`, CF-Access login) under *workflows ▸ monet*.
- **Here (versioned snapshot):** this folder. Re-pull after editing on gin:
  `scp gin:'~/dev/ComfyUI/user/default/workflows/monet/*.json' workflows/`

## Access paths (why no comfy service token in `.env.local`)
- **Automation (Monetto):** `ssh gin` → `http://127.0.0.1:8188`. Sits *behind* Cloudflare
  Access, so **no service token needed**. This is the path the pipeline uses.
- **HTTPS direct (`comfy.sprited.ai`):** gated by Cloudflare Access → needs a CF Access
  **service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret`). Only required if we
  ever call the public URL programmatically. Not used by monet today.

## The three starters
| file | base | status |
|---|---|---|
| `wan2_2_i2v.json` | Jin's working Wan 2.2 14B i2v | ✅ runs as-is (models all installed: umt5 + wan2.1 vae + wan2.2 high/low 14B + lightx2v 4-step LoRAs) |
| `ltx2_3_i2v.json` | official LTX-2.3 22B i2v template | ⚠️ patched to installed models; 2 optional nodes to remove (below) |
| `ltx2_3_i2v_lora.json` | official LTX-2.3 i2v + LoRA slot | ⚠️ same; this is your **LoRA-customize** starting point |

## LTX model swaps already applied (template ref → installed)
- `gemma_3_12B_it_fp4_mixed` → `gemma_3_12B_it_fp8_scaled`
- `ltx_2.3_22b_distilled_1.1_lora_dynamic_…_bf16` → `ltx_2.3_22b_distilled_1.1_lora`
- `ltx-2.3-spatial-upscaler-x2-1.1` → `…x2-1.0`

### Still to resolve in the LTX graphs (your two MarkdownNote-guided tweaks)
- **Remove / disable** the gemma LoRA node referencing
  `gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors` (not installed; it's an optional
  text-encoder LoRA). Or download it.
- **Audio branch:** references `ltx-av-…_vocoder_24K.safetensors` (not installed). Either skip the
  audio decode nodes, or download the vocoder if you want LTX's synced audio.

## LoRAs available on gin (for the LoRA slot)
- LTX: `ltx_2.3_22b_distilled_1.1_lora` (speed/distilled), `ltx23_Sulphur_better_NSFW_motion`, `DR34ML4Y_LTXXX_V2`
- Wan: `wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise` (4-step speed), `SVI_v2_PRO_…{HIGH,LOW}`

## Upscaling
- **LTX i2v already upscales internally** (LTXVLatentUpsampler + spatial-upscaler-x2 in the graph).
- **Wan output**: upscale separately with `RealESRGAN_x4plus_anime_6B.pth` (per-frame). A standalone
  `video_upscale.json` (VHS LoadVideo → ImageUpscaleWithModel → VideoCombine) is the next build —
  this will be the "additional upscaler pass" so Wan/Seedance-480p clips get a free 4× bump.

## Next (not built yet — Jin's larger ask)
- **Combined LTX‖Wan parallel graph using subgraphs** (one input image → both engines → compare),
  with the LoRA loaders exposed as subgraph inputs.
- **Standalone `video_upscale.json`** (RealESRGAN per-frame) running as a follow-on pass.
- Wire `scripts/` to drive these over `ssh gin → :8188/prompt` (queue API) for headless gen.
