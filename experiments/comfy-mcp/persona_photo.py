"""Photoreal "real human photo" variations of Monet (PERSONA.png) via FLUX Kontext.

Kontext re-renders the anime PERSONA in a photographic style while preserving
identity + layout. We upload PERSONA.png once, then run a handful of
prompt/seed variations (studio / outdoor / golden-hour / candid).

Subject is an ADULT woman (21+); all prompts keep her clearly adult, clothed, SFW.

Output: out/wholesome/photos/photo-<variant>.png
"""

from __future__ import annotations

from pathlib import Path

from comfy_client import Comfy

REPO = Path(__file__).resolve().parents[2]
PERSONA = REPO / "PERSONA.png"
OUT_DIR = Path(__file__).parent / "out" / "wholesome" / "photos"

# Shared identity clause repeated in every prompt so Kontext anchors the face/hair/outfit.
IDENTITY = (
    "a real adult woman in her mid-twenties, clearly an adult, "
    "keep her exact face and gentle features, short silver-lavender bob hairstyle, "
    "and her white long-sleeve dress. Photorealistic, natural skin texture with "
    "visible pores, realistic eyes, real human photograph, not an illustration, "
    "not anime, not 3d render. Tasteful, fully clothed."
)

# (variant, prompt, seed)
VARIANTS = [
    (
        "studio",
        f"Turn this into a realistic studio headshot photograph of {IDENTITY} "
        "Clean neutral grey backdrop, soft key light and fill, 85mm portrait lens, "
        "shallow depth of field, professional portrait photography.",
        880601,
    ),
    (
        "outdoor",
        f"Turn this into a realistic candid outdoor photograph of {IDENTITY} "
        "Standing in a green park on an overcast day, soft natural diffused daylight, "
        "35mm lens, gentle bokeh, lifestyle photography.",
        991702,
    ),
    (
        "golden-hour",
        f"Turn this into a realistic golden-hour photograph of {IDENTITY} "
        "Warm low evening sun, backlit hair rim light, soft lens flare, "
        "85mm portrait lens, dreamy warm tones, outdoor.",
        445503,
    ),
    (
        "candid",
        f"Turn this into a realistic candid snapshot photograph of {IDENTITY} "
        "Sitting by a cafe window, soft window light, natural relaxed expression, "
        "50mm lens, everyday documentary photography, film grain.",
        667204,
    ),
]


def build(image_name: str, prompt: str, seed: int) -> dict:
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-dev-kontext_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "clip": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "img": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "scale": {"class_type": "FluxKontextImageScale", "inputs": {"image": ["img", 0]}},
        "enc": {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": ["vae", 0]}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["clip", 0]}},
        "ref": {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["pos", 0], "latent": ["enc", 0]}},
        "guid": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["ref", 0], "guidance": 2.5}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
        "samp": {"class_type": "KSampler", "inputs": {
            "model": ["unet", 0], "positive": ["guid", 0], "negative": ["neg", 0],
            "latent_image": ["enc", 0], "seed": seed, "steps": 24, "cfg": 1.0,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["samp", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": "monet/photo"}},
    }


def main() -> None:
    c = Comfy()
    print(f"server: {c.base}\nuploading PERSONA: {PERSONA.name}")
    name = c.upload_image(PERSONA)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for variant, prompt, seed in VARIANTS:
        print(f"\n[{variant}] queueing (seed {seed}) …")
        try:
            pid = c.queue(build(name, prompt, seed))
            entry = c.wait(pid, timeout=600)
        except Exception as e:  # noqa: BLE001 - report and move on, don't loop
            print(f"  FAILED [{variant}]: {e}")
            continue
        imgs = c.images(entry)
        if not imgs:
            print(f"  NO IMAGE [{variant}]. status:", entry.get("status"))
            continue
        dest = OUT_DIR / f"photo-{variant}.png"
        c.download(imgs[0], dest)
        print(f"  saved {dest}")


if __name__ == "__main__":
    main()
