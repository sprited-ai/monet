"""Full-body PERSONA.png from the character DNA via FLUX Kontext.

DNA = references/inspirations/alternative-concept-1.png (silver-lavender bob, gentle eyes,
ethereal sparkle). Kontext reframes the headshot into a full-body view while keeping
identity + style. Result is saved to the repo root as PERSONA.png.
"""

from __future__ import annotations

from pathlib import Path

from comfy_client import Comfy

REPO = Path(__file__).resolve().parents[2]
DNA = REPO / "references" / "inspirations" / "alternative-concept-1.png"

PROMPT = (
    "Show this exact same young woman in a full body shot, standing, head to toe, "
    "the entire figure visible including legs and feet. Keep her face, silver-lavender "
    "short bob hairstyle, gentle expression, and soft ethereal anime illustration style "
    "identical. Full-length character reference, simple soft light background."
)
SEED = 880601


def build(image_name: str) -> dict:
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-dev-kontext_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "clip": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "img": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "scale": {"class_type": "FluxKontextImageScale", "inputs": {"image": ["img", 0]}},
        "enc": {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": ["vae", 0]}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["clip", 0]}},
        "ref": {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["pos", 0], "latent": ["enc", 0]}},
        "guid": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["ref", 0], "guidance": 2.5}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
        "samp": {"class_type": "KSampler", "inputs": {
            "model": ["unet", 0], "positive": ["guid", 0], "negative": ["neg", 0],
            "latent_image": ["enc", 0], "seed": SEED, "steps": 24, "cfg": 1.0,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/persona"}},
    }


def main():
    c = Comfy()
    print(f"server: {c.base}\nuploading DNA: {DNA.name}")
    name = c.upload_image(DNA)
    pid = c.queue(build(name))
    print(f"queued {pid}; waiting (flux kontext is slower)...")
    entry = c.wait(pid, timeout=600)
    imgs = c.images(entry)
    if not imgs:
        print("NO IMAGE. status:", entry.get("status"))
        return
    dest = REPO / "PERSONA.png"
    c.download(imgs[0], dest)
    print(f"saved {dest}")


if __name__ == "__main__":
    main()
