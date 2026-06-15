"""Artwork track — Monet's painterly practice using the installed fine-art LoRAs.

Three engines, one per base, each stacking a painterly LoRA:
  - flux_lora   : flux1-dev + Daubrez (DBRZ)       — best landscapes/light
  - vpred_lora  : NoobAI-XL-Vpred + Impasto         — impressionist/impasto (v_pred fix applied)
  - sdxl_lora   : WAI-Illustrious + ClassipeintXL   — classic oil

Subjects = the lane the audience sim favored (warm impressionist: garden / water /
still life / animals) plus one painterly *person* (she draws people too).
Output -> out/wholesome/artwork/<style>__<subject>.png  (+ contact sheet).
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy

NEG = (
    "child, loli, kid, minor, lowres, bad anatomy, bad hands, jpeg artifacts, "
    "signature, watermark, text, worst quality, low quality, ugly, deformed"
)

# subject key -> natural-language description (no Monet herself)
SUBJECTS = {
    "garden": "a flower garden in full bloom, dappled sunlight through trees, golden hour, no people",
    "waterlilies": "a pond covered in water lilies, soft reflections on still water, plein air, no people",
    "sunflowers": "a still life, a vase of sunflowers on a windowsill in morning light, no people",
    "cat": "a cat asleep on a sunlit windowsill, warm and cozy",
    "reader": "a young woman reading a book by a window, soft warm light, quiet",
}


def flux_lora(prompt, w, h, seed):
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-dev.safetensors", "weight_dtype": "default"}},
        "clip": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "lora": {"class_type": "LoraLoader", "inputs": {"model": ["unet", 0], "clip": ["clip", 0], "lora_name": "FLUX-daubrez-DB4RZ.safetensors", "strength_model": 0.9, "strength_clip": 0.9}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"DBRZ, impressionist painting, {prompt}, thick visible brushstrokes, warm light", "clip": ["lora", 1]}},
        "guid": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["pos", 0], "guidance": 3.2}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
        "latent": {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "samp": {"class_type": "KSampler", "inputs": {"model": ["lora", 0], "positive": ["guid", 0], "negative": ["neg", 0], "latent_image": ["latent", 0], "seed": seed, "steps": 22, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/art"}},
    }


def vpred_lora(prompt, w, h, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "NoobAI-XL-Vpred-v1.0.safetensors"}},
        "msd": {"class_type": "ModelSamplingDiscrete", "inputs": {"model": ["ckpt", 0], "sampling": "v_prediction", "zsnr": True}},
        "lora": {"class_type": "LoraLoader", "inputs": {"model": ["msd", 0], "clip": ["ckpt", 1], "lora_name": "noobai_vpred_1_style_painterly_v1.1.safetensors", "strength_model": 0.85, "strength_clip": 0.85}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"masterpiece, best quality, painterly, impasto, impressionism, oil painting \\(medium\\), {prompt}", "clip": ["lora", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["lora", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "samp": {"class_type": "KSampler", "inputs": {"model": ["lora", 0], "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["latent", 0], "seed": seed, "steps": 30, "cfg": 5.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/art"}},
    }


def sdxl_lora(prompt, w, h, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "waiIllustriousSDXL_v170.safetensors"}},
        "lora": {"class_type": "LoraLoader", "inputs": {"model": ["ckpt", 0], "clip": ["ckpt", 1], "lora_name": "ClassipeintXL2.1.safetensors", "strength_model": 0.85, "strength_clip": 0.85}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"masterpiece, best quality, oil painting, painterly, {prompt}", "clip": ["lora", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["lora", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "samp": {"class_type": "KSampler", "inputs": {"model": ["lora", 0], "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["latent", 0], "seed": seed, "steps": 30, "cfg": 5.0, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/art"}},
    }


STYLES = {"daubrez-flux": flux_lora, "impasto-noobai": vpred_lora, "classipeint-sdxl": sdxl_lora}
W, H = 1216, 832  # landscape orientation suits most subjects
SEED = 880601


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "wholesome" / "artwork"
    print(f"server: {c.base}")
    for style, builder in STYLES.items():
        for subj, desc in SUBJECTS.items():
            pid = c.queue(builder(desc, W, H, SEED))
            t0 = time.time()
            imgs = c.images(c.wait(pid, timeout=420))
            if imgs:
                c.download(imgs[0], out / f"{style}__{subj}.png")
                print(f"  {style:16} {subj:12} -> ok  ({time.time()-t0:.1f}s)")
            else:
                print(f"  {style:16} {subj:12} -> NO IMAGE")


if __name__ == "__main__":
    main()
