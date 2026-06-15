"""Ethereal direction — Monet dissolving into light.

Inspired by a reference Jin liked: soft-focus, heavy bloom, pastel blue/pink haze,
a short-bob figure glowing from within, full body, almost dissolving into light.
Reads naturally as an android-of-light. Output -> out/wholesome/ethereal/.
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy

CKPT = "rinFlanimeIllustrious_v40.safetensors"
Q = "masterpiece, best quality, very aesthetic, absurdres"
# Strategy: ABSTRACT her away — HIGH-KEY dissolve. Pale, overexposed, flooded with
# soft white light; the figure barely distinguishable from the glow. (Ref Jin liked.)
STYLE = (
    "(high key:1.3), (overexposed:1.3), washed out, pale, faded, low contrast, "
    "flooded with soft white light, bright pale background, (extreme soft focus:1.5), "
    "(heavy bloom:1.4), figure dissolving into light, translucent, semi-transparent, faint, "
    "barely visible, indistinct, no outlines, features obscured, faceless, hazy mist, "
    "impressionistic, pastel, minimalist, vast empty space, full body, standing far away, "
    "suggestion of a short bob and a soft dress"
)
SUBJECT = "a faint solitary figure, adult"
NEG = (
    "dark background, black background, vibrant, saturated, neon, glowing aura, flame, smoke, "
    "high contrast, sharp focus, fine outlines, crisp lines, lineart, detailed face, "
    "defined facial features, eye contact, hard edges, child, loli, minor, "
    "lowres, bad anatomy, jpeg artifacts, signature, watermark, text, worst quality, low quality"
)

# (key, palette/composition/mood). Wide net — accumulate; one will fly.
# Add freely; runs are ADDITIVE (never deletes), each gets a unique seed.
VARIANTS = [
    ("blue-pink-halo", "pastel blue and pink haze, a faint halo of light above her head"),
    ("lavender-veil", "soft lavender and white, veiled in drifting mist"),
    ("mint-fade", "pale mint and white, lower body fading into nothing"),
    ("peach-dawn", "warm peach and pale blue, soft sunrise glow"),
    ("gold-white", "pale gold and white light, radiant, almost blinding"),
    ("silver-blue", "cool silver-blue, frost light, crystalline mist"),
    ("rosegold-mist", "rose gold and cream mist, warm faint"),
    ("monochrome-white", "almost pure white on white, ghostly, barely there"),
    ("teal-rose", "teal and rose pastel, soft gradient"),
    ("ice-violet", "icy violet and white, cold bloom"),
    ("tiny-distant", "a tiny distant figure in a vast field of pale blue-pink light"),
    ("petals", "drifting pink flower petals, pale blue haze, soft"),
    ("faceless-bloom", "face entirely lost in bloom, lavender and white, unrecognizable"),
    ("backlit-window", "backlit by a bright window, pale interior light, blue and pink"),
    ("water-mist", "standing in shallow still water, pale reflections, low mist"),
    ("aurora-soft", "faint aurora colors bleeding into white, dissolving"),
]
SEED_BASE = 707007
W, H = 768, 1280


def graph(palette, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{Q}, {SUBJECT}, {STYLE}, {palette}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "samp": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
            "latent_image": ["latent", 0], "seed": seed, "steps": 30, "cfg": 3.5,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/ethereal"}},
    }


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "wholesome" / "ethereal"
    print(f"server: {c.base}  (additive — existing files kept)")
    for i, (key, palette) in enumerate(VARIANTS):
        seed = SEED_BASE + i
        pid = c.queue(graph(palette, seed))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=300))
        if imgs:
            c.download(imgs[0], out / f"{key}-{seed}.png")
            print(f"  {key:16} {seed} -> ok  ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
