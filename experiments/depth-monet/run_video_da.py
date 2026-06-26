#!/usr/bin/env python
"""Video Depth Anything on Monet stacked-alpha clips (runs on gin).

Stacked-alpha layout: a clip is W x 2H. Top H = RGB char on black,
bottom H = white silhouette (alpha matte). We run temporal video depth on
the RGB half, then mask the depth by the alpha so only the character carries
depth (background black -> depth 0 / NaN).

Outputs per clip (into --out):
  <name>_depth_gray.mp4   masked gray depth, normalized within the silhouette
  <name>_depth.npz        raw float32 relative depth [T,H,W] + alpha [T,H,W]
  <name>_montage.mp4      side-by-side RGB | masked-gray (sanity check)
"""
import argparse, os, sys, gc
import numpy as np
import cv2
import torch

NODE = os.path.expanduser("~/dev/ComfyUI/custom_nodes/ComfyUI-Video-Depth-Anything")
sys.path.insert(0, NODE)
from video_depth_anything.video_depth import VideoDepthAnything  # noqa

MODELS = os.path.expanduser("~/dev/ComfyUI/models/videodepthanything")
CFG = {
    'vits': {'encoder': 'vits', 'features': 64,  'out_channels': [48, 96, 192, 384]},
    'vitl': {'encoder': 'vitl', 'features': 256, 'out_channels': [256, 512, 1024, 1024]},
}


class Pbar:
    def __init__(self): self.n = 0
    def update(self, k=1): self.n += k


def load_stacked(path):
    """Return (rgb[T,H,W,3] uint8, alpha[T,H,W] float 0..1)."""
    cap = cv2.VideoCapture(path)
    rgb, alpha = [], []
    while True:
        ok, f = cap.read()
        if not ok: break
        H = f.shape[0] // 2
        top = cv2.cvtColor(f[:H], cv2.COLOR_BGR2RGB)
        bot = cv2.cvtColor(f[H:], cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        rgb.append(top); alpha.append(bot)
    cap.release()
    return np.stack(rgb), np.stack(alpha)


def load_model(encoder):
    os.makedirs(MODELS, exist_ok=True)
    name = f"video_depth_anything_{encoder}.pth"
    path = os.path.join(MODELS, name)
    if not os.path.exists(path):
        from huggingface_hub import snapshot_download
        repo = {'vits': "depth-anything/Video-Depth-Anything-Small",
                'vitl': "depth-anything/Video-Depth-Anything-Large"}[encoder]
        print(f"downloading {repo} ...")
        snapshot_download(repo_id=repo, allow_patterns=[f"*{name}*"], local_dir=MODELS)
    m = VideoDepthAnything(**CFG[encoder])
    sd = torch.load(path, map_location="cpu")
    m.load_state_dict(sd, strict=True)
    return m.to("cuda").eval()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="+")
    ap.add_argument("--out", default=os.path.expanduser("~/dev/depth-monet/out"))
    ap.add_argument("--encoder", default="vitl", choices=["vits", "vitl"])
    ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--no-npz", action="store_true", help="skip the 170MB float npz")
    ap.add_argument("--no-montage", action="store_true", help="skip the RGB|depth montage")
    ap.add_argument("--crf", type=int, default=10, help="libx264 CRF for the depth mp4 (lower=better)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    model = load_model(args.encoder)
    for clip in args.clips:
        name = os.path.splitext(os.path.basename(clip))[0]
        print(f"\n=== {name} ===")
        rgb, alpha = load_stacked(clip)
        T, H, W = alpha.shape
        print(f"  {T} frames @ {W}x{H}, encoder={args.encoder}")

        depth = model.infer_video_depth(rgb, input_size=518, device="cuda",
                                        pbar=Pbar(), fp32=False)
        depth = np.asarray(depth, dtype=np.float32)  # [T,H,W], larger = nearer

        # normalize within the union silhouette so the gray range uses the body
        mask = alpha > 0.5
        vals = depth[mask]
        lo, hi = np.percentile(vals, 1), np.percentile(vals, 99)
        norm = np.clip((depth - lo) / max(hi - lo, 1e-6), 0, 1)
        gray = (norm * 255).astype(np.uint8)
        gray_masked = (gray * (alpha > 0.5)).astype(np.uint8)

        if not args.no_npz:
            np.savez_compressed(os.path.join(args.out, f"{name}_depth.npz"),
                                depth=depth, alpha=alpha, lo=lo, hi=hi)

        # depth mp4: high-quality libx264 (this is the stored asset) via imageio.
        import imageio.v2 as imageio
        depth_path = os.path.join(args.out, f"{name}_depth.mp4")
        wr = imageio.get_writer(depth_path, fps=args.fps, codec="libx264",
                                quality=None, pixelformat="yuv420p",
                                output_params=["-crf", str(args.crf), "-preset", "slow"])
        for t in range(T):
            wr.append_data(gray_masked[t])  # HxW uint8 -> luma
        wr.close()

        if not args.no_montage:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            vm = cv2.VideoWriter(os.path.join(args.out, f"{name}_montage.mp4"),
                                 fourcc, args.fps, (W * 2, H))
            for t in range(T):
                g3 = cv2.cvtColor(gray_masked[t], cv2.COLOR_GRAY2BGR)
                left = cv2.cvtColor(rgb[t], cv2.COLOR_RGB2BGR)
                vm.write(np.hstack([left, g3]))
            vm.release()
        print(f"  saved {name}_depth.mp4"
              f"{'' if args.no_npz else ' +npz'}{'' if args.no_montage else ' +montage'}")
        gc.collect(); torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
