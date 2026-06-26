#!/usr/bin/env python
"""NormalCrafter (temporally-consistent video normals) on a Monet stacked clip.

Runs the NormalCrafter pipeline directly (bypassing the ComfyUI node) on the RGB
top half, masks by the alpha bottom half. NormalCrafter = SVD-based video normal
estimator -> no per-frame flicker (unlike Marigold), Marigold-level detail.

Out: <name>_normalcrafter.mp4 (masked normal video) + <name>_nc_frame<F>.png
"""
import argparse, os, sys
import numpy as np
import cv2
import torch

NC = os.path.expanduser("~/dev/ComfyUI/custom_nodes/ComfyUI-NormalCrafterWrapper")
sys.path.insert(0, NC)
from normalcrafter.normal_crafter_ppl import NormalCrafterPipeline
from normalcrafter.unet import DiffusersUNetSpatioTemporalConditionModelNormalCrafter
from diffusers import AutoencoderKLTemporalDecoder
from huggingface_hub import snapshot_download

NC_REPO = "Yanrui95/NormalCrafter"
SVD_REPO = "stabilityai/stable-video-diffusion-img2vid-xt"
MODELS = os.path.expanduser("~/dev/ComfyUI/models/normalcrafter")


def load_stacked(path):
    cap = cv2.VideoCapture(path)
    rgb, alpha = [], []
    while True:
        ok, f = cap.read()
        if not ok: break
        H = f.shape[0] // 2
        rgb.append(cv2.cvtColor(f[:H], cv2.COLOR_BGR2RGB))
        alpha.append(cv2.cvtColor(f[H:], cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0)
    cap.release()
    return np.stack(rgb), np.stack(alpha)


def load_pipe():
    local = MODELS
    if not os.path.exists(os.path.join(local, "unet", "config.json")):
        print(f"downloading {NC_REPO} ...")
        snapshot_download(repo_id=NC_REPO, local_dir=local, local_dir_use_symlinks=False)
    unet = DiffusersUNetSpatioTemporalConditionModelNormalCrafter.from_pretrained(
        local, subfolder="unet", low_cpu_mem_usage=True, torch_dtype=torch.float16)
    vae = AutoencoderKLTemporalDecoder.from_pretrained(
        local, subfolder="vae", low_cpu_mem_usage=True, torch_dtype=torch.float16)
    pipe = NormalCrafterPipeline.from_pretrained(
        SVD_REPO, unet=unet, vae=vae, torch_dtype=torch.float16, variant="fp16")
    pipe.to("cuda")
    try:
        pipe.enable_xformers_memory_efficient_attention()
    except Exception as e:
        print("xformers off:", repr(e)[:80])
    return pipe


def process(pipe, clip, out_dir, fps, window, step, suffix, crf, save_frame):
    name = os.path.splitext(os.path.basename(clip))[0]
    rgb, alpha = load_stacked(clip)
    T, H, W = alpha.shape
    # SVD UNet needs H,W divisible by 64; feed a ceil-to-64 resize, restore (H,W) after.
    Hp, Wp = ((H + 63) // 64) * 64, ((W + 63) // 64) * 64
    rgb_in = rgb if (Hp, Wp) == (H, W) else np.stack(
        [cv2.resize(f, (Wp, Hp), interpolation=cv2.INTER_AREA) for f in rgb])
    images = torch.from_numpy(rgb_in.astype(np.float32) / 255.0).to("cuda")  # (T,Hp,Wp,3)
    gen = torch.Generator(device="cuda").manual_seed(42)
    with torch.inference_mode():
        out = pipe(images=images, decode_chunk_size=8, time_step_size=step,
                   window_size=window, fps=7, motion_bucket_id=127,
                   noise_aug_strength=0.0, generator=gen).frames[0]
    if torch.is_tensor(out):
        out = out.float().cpu().numpy()
    out = np.asarray(out, dtype=np.float32)
    if out.ndim == 4 and out.shape[1] in (1, 3) and out.shape[-1] not in (1, 3):
        out = np.transpose(out, (0, 2, 3, 1))
    if out.min() < -0.01:           # [-1,1] -> [0,1]
        out = out * 0.5 + 0.5
    out = np.clip(out, 0, 1)
    if out.shape[1:3] != (H, W):
        out = np.stack([cv2.resize(o, (W, H)) for o in out])
    vis = ((out * 255).astype(np.uint8)) * (alpha > 0.5)[..., None]

    # high-quality libx264 (stored asset), same as the depth sidecars
    import imageio.v2 as imageio
    path = os.path.join(out_dir, f"{name}{suffix}")
    wr = imageio.get_writer(path, fps=fps, codec="libx264", quality=None,
                            pixelformat="yuv420p",
                            output_params=["-crf", str(crf), "-preset", "slow"])
    for t in range(T):
        wr.append_data(vis[t])
    wr.close()
    if save_frame:
        cv2.imwrite(os.path.join(out_dir, f"{name}_nc_frame60.png"),
                    cv2.cvtColor(vis[min(60, T - 1)], cv2.COLOR_RGB2BGR))
    print(f"  saved {name}{suffix}  ({T}f @ {W}x{H})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="+")
    ap.add_argument("--out", default=os.path.expanduser("~/dev/depth-monet/out"))
    ap.add_argument("--suffix", default=".normal.mp4", help="output sidecar suffix")
    ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--window", type=int, default=14)
    ap.add_argument("--step", type=int, default=10)
    ap.add_argument("--crf", type=int, default=12)
    ap.add_argument("--save-frame", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    pipe = load_pipe()
    for i, clip in enumerate(args.clips):
        print(f"[{i+1}/{len(args.clips)}] {os.path.basename(clip)}")
        try:
            process(pipe, clip, args.out, args.fps, args.window, args.step,
                    args.suffix, args.crf, args.save_frame)
        except Exception as e:
            print(f"  FAILED {clip}: {repr(e)[:200]}")
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
