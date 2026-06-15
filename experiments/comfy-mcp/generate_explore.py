"""Style + subject EXPLORATION for Monet-as-art-student.

We're not converging yet — the goal is breadth. A diverse grid of (subject x style)
spanning people, portraits, still life, landscape, animals, drawn across the most
stylistically-distinct checkpoints already on the server (sketch / flat / comic /
clean-anime / v-pred painterly). No new downloads needed.

Subjects deliberately include PEOPLE (she's a student practicing the whole range),
not just landscapes, and never Monet herself.
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy

Q = "masterpiece, best quality, very aesthetic, detailed"
NEG = (
    "child, loli, kid, lowres, bad anatomy, bad hands, missing fingers, extra digits, "
    "jpeg artifacts, signature, watermark, username, text, worst quality, low quality, ugly"
)

SKETCH = "Perfect_Sketchbook__SketchyAnimeStyle.safetensors"
COAMIX = "CoaMixXL_Anim4gine__v5_0.safetensors"
YUME = "CocoaMix_Yume_Illustrious_v_pred__v5_0.safetensors"
FLAT = "Diving_Illustrious_Flat_Anime_Paradigm_Shift__v8_0_VAE.safetensors"
COMIC = "Nova_Comic_XL__v2_0.safetensors"

# (label, checkpoint, prompt, width, height)
EXPLORE = [
    ("figure-gesture-sketch", SKETCH, "graphite gesture drawing of a standing woman, quick loose sketch, hatching, sketchbook study, monochrome", 832, 1216),
    ("anatomy-study-sketch", SKETCH, "anatomy study sketch, human arm and hand studies, pencil drawing, sketchbook page, monochrome", 1024, 1024),
    ("portrait-charcoal", SKETCH, "charcoal portrait of an old man, weathered face, expressive smudged shading, monochrome drawing", 832, 1216),
    ("portrait-oil-stranger", YUME, "classical oil painting portrait of a young woman, soft chiaroscuro, painterly brushwork, warm tones", 832, 1216),
    ("portrait-anime-youth", COAMIX, "portrait of a young man, clean anime illustration, soft cel shading, simple background", 832, 1216),
    ("stilllife-sunflowers", YUME, "impressionist oil painting, vase of sunflowers on a wooden table, thick brushstrokes, warm light, no humans", 1024, 1024),
    ("landscape-waterlilies", YUME, "impressionist landscape, pond with water lilies, soft reflections, plein air, dappled light, no humans, thick brushstrokes", 1216, 832),
    ("monet-garden", YUME, "in the style of Claude Monet, flower garden in bloom, dappled sunlight, impressionism, visible brushstrokes, no humans", 1216, 832),
    ("street-cafe-watercolor", COAMIX, "loose watercolor painting, quiet european street cafe, afternoon light, a few figures, wet-on-wet", 1216, 832),
    ("cat-watercolor", COAMIX, "watercolor painting of a sleeping cat on a sunlit windowsill, soft wash, gentle", 1024, 1024),
    ("hills-flat", FLAT, "flat illustration, rolling hills at sunset, minimal clean shapes, bold color blocks, no humans", 1216, 832),
    ("fruit-comic", COMIC, "comic book style still life, bowl of fruit, bold ink outlines, halftone, dramatic", 1024, 1024),
]

SEED = 880601


def graph(ckpt, prompt, w, h, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{Q}, {prompt}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "sampler": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
            "latent_image": ["latent", 0], "seed": seed, "steps": 30, "cfg": 5.0,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "monet/explore"}},
    }


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "wholesome" / "explore"
    print(f"server: {c.base}")
    for label, ckpt, prompt, w, h in EXPLORE:
        pid = c.queue(graph(ckpt, prompt, w, h, SEED))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=300))
        if imgs:
            c.download(imgs[0], out / f"{label}.png")
            print(f"  {label:26} -> {label}.png  ({time.time()-t0:.1f}s)")
        else:
            print(f"  {label:26} -> NO IMAGE")


if __name__ == "__main__":
    main()
