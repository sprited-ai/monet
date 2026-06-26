#!/usr/bin/env python3
"""Render a self-driven pose sequence through THA4 — RUNS ON GIN.

Reuses tha4_render.py's poser. Reads pose_sequence.json (from tha4_drive.py) + the Monet
THA4 image, renders one frame per pose vector to a PNG sequence, then ffmpeg -> silent mp4.
Audio is muxed back on the Mac side (her voice).

Run from ~/dev/monet/experiments/tha4 with its .venv:
  .venv/bin/python /path/tha4_talk.py --image data/images/monet_512.png \
      --poses /path/pose_sequence.json --out /path/monet_talk_silent.mp4
"""
import argparse, json, os, subprocess, time, tempfile
import numpy as np, torch, PIL.Image
from tha4.poser.modes.mode_07 import create_poser
from tha4.poser.modes.pose_parameters import get_pose_parameters
from tha4.shion.base.image_util import extract_pytorch_image_from_PIL_image
from tha4.image_util import resize_PIL_image

def to_pil(out_tensor):
    img = ((out_tensor + 1.0) / 2.0).clamp(0, 1)
    arr = (img.permute(1, 2, 0).numpy() * 255).astype(np.uint8)
    return PIL.Image.fromarray(arr, "RGBA")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--poses", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bg", default="white", choices=["white", "transparent"])
    a = ap.parse_args()
    seq = json.load(open(a.poses))
    fps, frames = seq["fps"], seq["frames"]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    poser = create_poser(device); poser.get_modules()
    pp = get_pose_parameters(); n = poser.get_num_parameters()
    pil = resize_PIL_image(PIL.Image.open(a.image).convert("RGBA"),
                           (poser.get_image_size(), poser.get_image_size()))
    img = extract_pytorch_image_from_PIL_image(pil).to(device).to(torch.float32)

    tmp = tempfile.mkdtemp(prefix="tha4talk_")
    t0 = time.time()
    for i, named in enumerate(frames):
        v = [0.0] * n
        for k, val in named.items():
            v[pp.get_parameter_index(k)] = val
        pose = torch.tensor(v, device=device, dtype=torch.float32)
        with torch.no_grad():
            out = poser.pose(img, pose, 0)[0].detach().cpu()
        pim = to_pil(out)
        if a.bg == "white":
            bg = PIL.Image.new("RGB", pim.size, (255, 255, 255)); bg.paste(pim, (0, 0), pim); pim = bg
        pim.save(os.path.join(tmp, f"f_{i:04d}.png"))
    dt = time.time() - t0
    print(f"rendered {len(frames)} frames in {dt:.1f}s ({dt/len(frames)*1000:.0f} ms/frame, {len(frames)/dt:.1f} fps)")

    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                    "-i", os.path.join(tmp, "f_%04d.png"), "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "16", a.out], check=True)
    print("wrote", a.out)

if __name__ == "__main__":
    main()
