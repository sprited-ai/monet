"""Render the `portrait.png` design across the S-tier checkpoints from comfy-modex.

Jin's hand-selected S-tier image gens (results/tiers.json on gin):
  - Animagine XL v3.1   -> animagineXLV31_v31.safetensors
  - Nova Anime XL       -> novaAnimeXL_ilV190.safetensors
  - WAI-illustrious-SDXL-> waiIllustriousSDXL_v170.safetensors
CoaMix (the model that made the original portrait Jin liked) is kept as reference.

Prompt / NEG / sampler / cfg are held identical to the original portrait so the
*model* is the only variable — same isolation principle as comfy-modex's eval.
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy
from generate_samples import QUALITY, NEG, MONET, WIDTH, HEIGHT, STEPS, CFG, SAMPLER, SCHED

# The portrait composition Jin liked, verbatim from generate_samples.SAMPLES["portrait"].
PORTRAIT = f"{MONET}, upper body, close-up portrait, looking at viewer, head tilt"

# Full S-tier per gin:~/dev/comfy-modex/results/ranking.md (eval-based ranking),
# restricted to SFW anime-illustration models. The two adult/photoreal S-tier
# models (pornmasterPro_noobV6, Hardcore_Asian_Cosplay_realistic_photo) are
# deliberately EXCLUDED — Monet is a young-girl character.
MODELS = {
    "cocoamix-yume": "CocoaMix_Yume_Illustrious_v_pred__v5_0.safetensors",
    "pvc-figure": "PVCStyleModelMovable_ckxlEPS11.safetensors",
    "dasiwa-illust": "DasiwaIllustriousAnime_epitaphecstasy.safetensors",
    "coamix": "CoaMixXL_Anim4gine__v5_0.safetensors",
    "rinflanime": "rinFlanimeIllustrious_v40.safetensors",
    "quartz": "quartz_v3.safetensors",
    "janku-noobai": "JANKUTrainedChenkinNoobai_v777.safetensors",
    "noobai-vpred": "NoobAI-XL-Vpred-v1.0.safetensors",
}
SEEDS = [771486, 771487, 880601]  # 771486 == the original portrait seed


def build_graph(ckpt: str, positive: str, seed: int) -> dict:
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{QUALITY}, {positive}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1}},
        "sampler": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
                "latent_image": ["latent", 0], "seed": seed, "steps": STEPS, "cfg": CFG,
                "sampler_name": SAMPLER, "scheduler": SCHED, "denoise": 1.0,
            },
        },
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "monet/var"}},
    }


def main() -> None:
    c = Comfy()
    out_dir = Path(__file__).parent / "out" / "wholesome" / "avatar"
    print(f"server: {c.base}")
    for key, ckpt in MODELS.items():
        for seed in SEEDS:
            pid = c.queue(build_graph(ckpt, PORTRAIT, seed))
            t0 = time.time()
            entry = c.wait(pid, timeout=300)
            imgs = c.images(entry)
            if imgs:
                dest = out_dir / f"{key}__{seed}.png"
                c.download(imgs[0], dest)
                print(f"  {key:12} seed={seed} -> {dest.name}  ({time.time() - t0:.1f}s)")
            else:
                print(f"  {key:12} seed={seed} -> NO IMAGE (entry status: {entry.get('status')})")


if __name__ == "__main__":
    main()
