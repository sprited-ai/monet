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
    ("pose-seated", "seated on the floor, knees drawn up, pale blue-pink haze, soft"),
    ("pose-walking-away", "walking away from viewer, seen from behind, dissolving into white light"),
    ("pose-looking-back", "glancing back over the shoulder, face half lost in bloom, lavender white"),
    ("pose-floating", "weightless, floating, hair drifting, surrounded by light particles, blue pink"),
    ("pose-curled", "curled up small, knees to chest, vast pale empty space around"),
    ("pose-reaching", "one arm reaching up toward the light, silhouette dissolving, gold white"),
    ("pose-profile", "side profile, gazing away, soft rim light, mint and white"),
    ("pose-kneeling", "kneeling, head bowed, faint halo, pale silver-blue"),
    ("crop-closeup", "extreme close-up of a face dissolving entirely into bloom, unrecognizable, white"),
    ("crop-waist", "waist-up, arms loose, features washed out, rose and cream"),
    ("two-figures", "two faint identical figures overlapping in the haze, ghostly, blue pink"),
    ("dissolve-extreme", "almost entirely dissolved into light, only the faintest hint of a figure, white void"),
]
SEED_BASE = 808100
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
