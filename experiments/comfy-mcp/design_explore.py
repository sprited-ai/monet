"""Alt character designs for Monet — a concept menu.

Model held constant (cocoamix-yume) so DESIGN is the only variable. Every design is
an adult (21+) art-student/painter, but hair / palette / outfit / vibe vary widely.
Output -> out/wholesome/avatar-designs/<key>.png  (+ contact sheet).
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy

CKPT = "CocoaMix_Yume_Illustrious_v_pred__v5_0.safetensors"
Q = "masterpiece, best quality, amazing quality, very aesthetic, absurdres"
# Monet is an android — shown subtly, not hidden, not overdone. Human-passing with a tell.
ANDROID = "(android:0.85), mostly human appearance, faint glowing seam line on neck, subtle synthetic skin sheen, softly luminous eyes, small glowing accent, not robotic, no visible machinery"
BASE = "1girl, solo, mature female, adult woman, 21 years old, art student, painter, upper body, looking at viewer, gentle smile, soft lighting, simple background"
NEG = (
    "child, loli, kid, toddler, minor, lowres, bad anatomy, bad hands, missing fingers, "
    "extra digits, jpeg artifacts, signature, watermark, text, worst quality, low quality, ugly"
)

DESIGNS = {
    "silver-bob-dna":   "short silver lavender bob, wavy bangs, violet eyes, white high-neck dress, ethereal, glowing sparkles",
    "blonde-curls":     "golden blonde curly hair, ringlets, rainbow hair bow, rust red dress, floral blouse, warm",
    "auburn-apron":     "long auburn wavy hair, green eyes, cream knit sweater, paint-stained apron, cozy studio",
    "beret-montmartre": "black bob, brown eyes, red beret, striped shirt, classic parisian painter, montmartre",
    "pink-cardigan":    "soft pink shoulder-length hair, blue eyes, oversized pastel cardigan, cozy, freckles",
    "white-ethereal":   "long flowing white hair, pale silver eyes, flowing white gown, dreamy, ethereal light",
    "overalls-studio":  "brown messy ponytail, freckles, denim overalls, holding paintbrush, bright studio",
    "teal-modern":      "teal short undercut hair, modern art student, oversized graphic tee, edgy, confident",
    "braids-cottage":   "strawberry blonde twin braids, gingham dress, sunflowers, cottagecore, golden field",
    "boho-lavender":    "long lavender hair, flowers in hair, flowy floral bohemian dress, plein air, breezy",
    "ash-gallery":      "ash grey bob, elegant, black turtleneck, refined, minimalist gallery, poised",
    "honey-bun-smock":  "honey blonde hair in a loose bun, round glasses, paint-smeared smock, focused, atelier",
    "raven-ink":        "long straight black hair, sharp dark eyes, ink-black blouse, holding ink brush, sumi-e studio",
    "ginger-scarf":     "wavy ginger hair, warm hazel eyes, mustard sweater, patterned scarf, autumn, sketchbook",
    "platinum-chic":    "platinum blonde pixie cut, blue eyes, white shirt, suspenders, chic, sunny loft",
    "rosewood-shawl":   "dark rosewood brown hair, soft braid, embroidered shawl, vintage, warm lamplight",
    # two that lean MORE visibly android, for calibrating how much to show:
    "porcelain-seams":  "short silver lavender bob, porcelain synthetic skin, fine visible seam lines on cheek and neck, soft inner glow, elegant",
    "panel-accent":     "ash blonde bob, a discreet glowing panel line along the jaw, faint circuit-light at the temple, white collar, refined android",
}
W, H = 832, 1216
SEED = 880601


def graph(design, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{Q}, {BASE}, {design}, {ANDROID}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "samp": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
            "latent_image": ["latent", 0], "seed": seed, "steps": 30, "cfg": 5.0,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/design"}},
    }


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "wholesome" / "avatar-designs"
    print(f"server: {c.base}")
    for key, design in DESIGNS.items():
        pid = c.queue(graph(design, SEED))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=300))
        if imgs:
            c.download(imgs[0], out / f"{key}.png")
            print(f"  {key:18} -> ok  ({time.time()-t0:.1f}s)")
        else:
            print(f"  {key:18} -> NO IMAGE")


if __name__ == "__main__":
    main()
