"""Two non-anime rendering languages for Monet (per Jin: no clean outline+fill).

  brush/*  — pure brushstrokes, NO outlines (daubrez-flux, impressionist)
  sketch/* — lines only, loose graphite/charcoal gesture (Perfect_Sketchbook)

Both keep the ethereal/abstracted, high-key dissolve. Output -> out/wholesome/style-test/.
Additive; rebuild grid to review.
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy
from artwork_gen import flux_lora  # Daubrez/Flux brushstroke engine

W, H = 832, 1216

# --- brush (no outlines) --- warm / orange palette, echoing the original (golden blonde, rust)
BRUSH = [
    ("brush-standing", "a golden blonde woman standing, soft rust-red dress, dissolving into warm orange and gold light, sunset glow, high key, overexposed, soft"),
    ("brush-seated", "a blonde woman seated, knees drawn up, faint in warm amber and peach haze, glowing"),
    ("brush-back", "a blonde woman seen from behind walking into warm golden light, terracotta, faded"),
    ("brush-closeup", "a face framed by golden blonde hair, half-dissolved in soft bloom, warm coral and cream, high key"),
    ("brush-profile", "side profile of a blonde woman gazing away, warm peach and orange mist, faint"),
    ("brush-floating", "a weightless blonde figure adrift in glowing warm amber light, golden, dissolving"),
]

# --- sketch (lines only) --- warm sanguine / sepia chalk, not cold graphite
SKETCH_CKPT = "Perfect_Sketchbook__SketchyAnimeStyle.safetensors"
SKETCH_Q = "loose sanguine conte gesture drawing, warm reddish-brown chalk, sepia tones, rough construction lines, unfinished sketch, hatching, warm cream paper, minimal, lots of space, sketchbook study"
SKETCH_NEG = "full color, rainbow, blue, painting, flat color fill, clean lineart, vector, anime screencap, cel shading, 3d, lowres, bad anatomy, bad hands, signature, watermark, text"
SKETCH = [
    ("sketch-gesture", "a standing woman, quick loose gesture"),
    ("sketch-seated", "a woman seated, knees up, soft pose"),
    ("sketch-back", "a woman from behind, walking away"),
    ("sketch-portrait", "a woman's face and shoulders, gentle, faint lines"),
    ("sketch-profile", "side profile of a woman gazing away"),
    ("sketch-reaching", "a woman reaching one arm upward, flowing line"),
]
SEED = 909000


def sketch_graph(prompt, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": SKETCH_CKPT}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{SKETCH_Q}, {prompt}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": SKETCH_NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "samp": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
            "latent_image": ["latent", 0], "seed": seed, "steps": 28, "cfg": 5.0,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/style"}},
    }


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "wholesome" / "style-test"
    print(f"server: {c.base}")
    for i, (key, prompt) in enumerate(BRUSH):
        pid = c.queue(flux_lora(prompt, W, H, SEED + i))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=420))
        if imgs:
            c.download(imgs[0], out / f"{key}.png")
            print(f"  {key:16} -> ok  ({time.time()-t0:.1f}s)")
    for i, (key, prompt) in enumerate(SKETCH):
        pid = c.queue(sketch_graph(prompt, SEED + 100 + i))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=300))
        if imgs:
            c.download(imgs[0], out / f"{key}.png")
            print(f"  {key:16} -> ok  ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
