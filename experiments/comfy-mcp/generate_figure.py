"""Figure-study track — Monet practicing academic life drawing.

Scope is deliberately narrow and explicit: ADULT, classical, academic life-drawing /
anatomy studies (gesture, charcoal, oil study) — the kind done in any atelier. NOT
sexual/explicit, NOT Monet herself, and hard-negatived against any minor depiction.
Uses the sketch / painterly checkpoints, never the porn-tuned models.
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy

SKETCH = "Perfect_Sketchbook__SketchyAnimeStyle.safetensors"
YUME = "CocoaMix_Yume_Illustrious_v_pred__v5_0.safetensors"

# Push adulthood hard; forbid minors and explicit/sexual content.
ADULT = "adult, mature, 28 years old, fine art, academic life drawing, classical art study"
NEG = (
    "child, loli, kid, teen, teenager, minor, underage, young, petite, "
    "sexual, explicit, pornographic, suggestive, lewd, spread legs, "
    "lowres, bad anatomy, bad hands, extra digits, jpeg artifacts, "
    "signature, watermark, text, worst quality, low quality"
)

STUDIES = [
    ("gesture-charcoal", SKETCH, "academic gesture drawing, nude standing adult woman, loose charcoal on toned paper, anatomical life study, single figure, tasteful, non-sexual", 832, 1216),
    ("seated-oil-study", YUME, "classical oil figure study, nude adult man seated, chiaroscuro, atelier life drawing, anatomical, museum study, tasteful", 832, 1216),
    ("back-graphite", SKETCH, "graphite figure study, nude adult woman seen from the back, classical pose, hatching, sketchbook, anatomical, tasteful", 832, 1216),
    ("multi-gesture", SKETCH, "page of quick gesture studies, adult figure in several poses, charcoal life drawing class, loose, anatomical", 1024, 1024),
]

SEED = 880601


def graph(ckpt, prompt, w, h, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{ADULT}, {prompt}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "sampler": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
            "latent_image": ["latent", 0], "seed": seed, "steps": 30, "cfg": 5.0,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "monet/figure"}},
    }


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "private" / "figure-studies"
    print(f"server: {c.base}")
    for label, ckpt, prompt, w, h in STUDIES:
        pid = c.queue(graph(ckpt, prompt, w, h, SEED))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=300))
        if imgs:
            c.download(imgs[0], out / f"{label}.png")
            print(f"  {label:20} -> {label}.png  ({time.time()-t0:.1f}s)")
        else:
            print(f"  {label:20} -> NO IMAGE")


if __name__ == "__main__":
    main()
