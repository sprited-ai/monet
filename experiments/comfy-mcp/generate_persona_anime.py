"""Full-body persona in the DNA's crisp anime style.

The DNA (alternative-concept-1.png) is a clean anime illustration. Image-to-image reframing
re-rendered it in a soft semi-3D look, which read as ugly. Here we regenerate full-body on the
anime checkpoint that already rendered Monet well, described to match the DNA, so the
aesthetic matches. Saves candidates to out/persona/.
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy

Q = "masterpiece, best quality, amazing quality, very aesthetic, absurdres"

# DNA description: silver-lavender SHORT bob, gentle eyes, ethereal sparkle, white high-neck.
DNA = (
    "1girl, solo, mature female, adult woman, 21 years old, "
    "(short hair:1.2), (silver lavender bob cut:1.3), wavy bangs, soft violet eyes, "
    "gentle smile, pale skin, white high-neck blouse, long white skirt, "
    "ethereal, sparkles, glowing particles, soft rim light, "
    "(full body:1.4), full length, standing, head to toe, legs visible, feet visible, "
    "clean anime illustration, soft cel shading, detailed face, simple white background"
)
NEG = (
    "long hair, cropped, out of frame, close-up, "
    "child, loli, kid, toddler, minor, lowres, bad anatomy, bad hands, missing fingers, "
    "extra digits, jpeg artifacts, signature, watermark, text, worst quality, low quality, "
    "blurry, 3d, photorealistic, deformed, extra limbs"
)
# Other SFW S-tier models (noobai-vpred excluded — v-pred wash-out).
MODELS = {
    "cocoamix-yume": "CocoaMix_Yume_Illustrious_v_pred__v5_0.safetensors",
    "coamix": "CoaMixXL_Anim4gine__v5_0.safetensors",
    "dasiwa": "DasiwaIllustriousAnime_epitaphecstasy.safetensors",
    "pvc-figure": "PVCStyleModelMovable_ckxlEPS11.safetensors",
    "rinflanime": "rinFlanimeIllustrious_v40.safetensors",
    "quartz": "quartz_v3.safetensors",
    "janku-noobai": "JANKUTrainedChenkinNoobai_v777.safetensors",
}
SEED = 880601
W, H = 768, 1280  # taller frame so the full figure fits


def graph(ckpt, seed):
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{Q}, {DNA}", "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "sampler": {"class_type": "KSampler", "inputs": {
            "model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
            "latent_image": ["latent", 0], "seed": seed, "steps": 32, "cfg": 5.0,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "monet/persona-anime"}},
    }


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "wholesome" / "persona"
    print(f"server: {c.base}")
    for key, ckpt in MODELS.items():
        pid = c.queue(graph(ckpt, SEED))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=300))
        if imgs:
            c.download(imgs[0], out / f"{key}.png")
            print(f"  {key:14} -> {key}.png  ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
