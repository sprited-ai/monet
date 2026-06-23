"""Generate sample drawings that fit Monet's persona (see ../../PERSONA.md).

Engine: CoaMixXL_Anim4gine v5 (Illustrious-based) on comfy.sprited.ai.
Aesthetic seed from PERSONA.md: golden-blonde curly hair, rainbow hair bow, warm
peachy skin, rust/mauve dress over small-floral white blouse, soft grey boots,
golden-hour garden warmth, hand-painted Impressionist light, Bluey-esque clean
charm, character-forward with a matte/empty background.
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy

CKPT = "CoaMixXL_Anim4gine__v5_0.safetensors"

# Illustrious-style quality scaffolding.
QUALITY = "masterpiece, best quality, amazing quality, very aesthetic, newest"
# Monet is an adult (21+). Push child/loli depictions firmly into the negative.
NEG = (
    "child, loli, kid, toddler, baby face, minor, teenager, young child, shota, "
    "worst quality, low quality, lowres, bad anatomy, bad hands, missing fingers, "
    "extra digits, jpeg artifacts, signature, watermark, username, text, "
    "busy background, cluttered, photorealistic, 3d, realistic, ugly"
)

# Monet's visual identity, expressed as a reusable tag block.
# She presents as a young woman (21+) — golden-hour, hand-painted, warm.
MONET = (
    "1girl, solo, mature female, adult woman, 21 years old, slender, "
    "golden blonde hair, long curly hair, ringlets, (rainbow hair bow:1.1), "
    "warm peachy skin, rust red dress, mauve dress, white blouse, "
    "small floral print, grey boots, gentle smile, "
    "soft golden hour lighting, warm light, painterly, impressionist, hand-painted, "
    "soft brushstrokes, simple background, cream background"
)

# Each sample varies pose/activity while holding the identity + aesthetic constant.
SAMPLES = [
    ("portrait", f"{MONET}, upper body, close-up portrait, looking at viewer, head tilt"),
    ("painter", f"{MONET}, full body, holding paintbrush, holding palette, standing, looking at viewer"),
    ("at-easel", f"{MONET}, painting on a canvas, easel, side view, focused expression, garden"),
    ("flowers", f"{MONET}, holding flowers, surrounded by soft flower petals, looking away, serene"),
]

WIDTH, HEIGHT = 896, 1152  # SDXL portrait
STEPS, CFG = 30, 5.0
SAMPLER, SCHED = "euler_ancestral", "normal"
BASE_SEED = 770601  # nods to her 2026-06-01 birthday


def build_graph(positive: str, seed: int) -> dict:
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{QUALITY}, {positive}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1}},
        "sampler": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["ckpt", 0],
                "positive": ["pos", 0],
                "negative": ["neg", 0],
                "latent_image": ["latent", 0],
                "seed": seed,
                "steps": STEPS,
                "cfg": CFG,
                "sampler_name": SAMPLER,
                "scheduler": SCHED,
                "denoise": 1.0,
            },
        },
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "monet/sample"}},
    }


def main() -> None:
    c = Comfy()
    out_dir = Path(__file__).parent / "out" / "wholesome" / "concept"
    print(f"server: {c.base}")
    for name, prompt in SAMPLES:
        seed = BASE_SEED + sum(ord(ch) for ch in name)
        pid = c.queue(build_graph(prompt, seed))
        print(f"  queued [{name}] seed={seed} -> {pid}")
        t0 = time.time()
        entry = c.wait(pid, timeout=300)
        for i, img in enumerate(c.images(entry)):
            dest = out_dir / f"{name}.png" if i == 0 else out_dir / f"{name}-{i}.png"
            c.download(img, dest)
            print(f"    saved {dest.relative_to(Path(__file__).parent)}  ({time.time() - t0:.1f}s)")


if __name__ == "__main__":
    main()
