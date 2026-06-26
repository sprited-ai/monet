# SAM-3D-Body rig extraction over ALL Monet clips.
# The ViTDet detector can't find the chibi, so we bypass it: tight per-frame bbox
# from the clip's own alpha (stacked-alpha mp4: color top / alpha-as-luma bottom),
# composite the color half on neutral gray, and feed (image, bbox) to the estimator.
# Saves the rich rig per clip as a compressed NPZ (2D/3D keypoints, 127-joint coords
# + global rotation matrices = the animation rig, hand/body pose params, hand bboxes).
import os, glob, subprocess, tempfile, time, sys
import numpy as np, cv2, torch
from PIL import Image
from sam_3d_body import load_sam_3d_body, SAM3DBodyEstimator
# QA render needs detectron2 + pyrender (not buildable on mac). Core inference doesn't —
# so guard the import: gin renders, mac just skips the mid-frame jpg.
try:
    from tools.vis_utils import visualize_sample_together
    _CAN_RENDER = True
except Exception as _e:
    _CAN_RENDER = False
    print(f"[render disabled] {type(_e).__name__}: {_e}")

# Paths are env-overridable so the same script runs anywhere (gen-sidecars.sh sets
# them); defaults match the gin layout. Existing <clip>.npz are skipped (no overwrite).
CLIP_DIR = os.environ.get("CLIP_DIR", "monet_clips")
OUT_DIR = os.environ.get("OUT_DIR", "sam3d_out")
CKPT_DIR = os.environ.get("SAM3D_CKPT_DIR", "./checkpoints/sam-3d-body-dinov3")
REND_DIR = os.path.join(OUT_DIR, "renders")
os.makedirs(REND_DIR, exist_ok=True)

_env_dev = os.environ.get("SAM_DEVICE")  # mac: the package hardcodes .cuda() in places,
if _env_dev:                             # so a patched-to-cpu run forces SAM_DEVICE=cpu
    device = torch.device(_env_dev)
elif torch.cuda.is_available():
    device = torch.device("cuda")
elif torch.backends.mps.is_available():
    device = torch.device("mps")  # run with PYTORCH_ENABLE_MPS_FALLBACK=1
else:
    device = torch.device("cpu")
print(f"device: {device}")
model, cfg = load_sam_3d_body(
    f"{CKPT_DIR}/model.ckpt", device=device,
    mhr_path=f"{CKPT_DIR}/assets/mhr_model.pt")
est = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=cfg,
                         human_detector=None, human_segmentor=None, fov_estimator=None)

# keys pulled from each detection's output dict (skip pred_vertices: 18k verts, regenerable)
KEYS = ["pred_keypoints_2d", "pred_keypoints_3d", "pred_joint_coords", "pred_global_rots",
        "hand_pose_params", "body_pose_params", "global_rot", "pred_cam_t", "focal_length",
        "scale_params", "shape_params", "expr_params", "lhand_bbox", "rhand_bbox", "bbox"]

def ffprobe_fps(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=r_frame_rate", "-of", "default=nokey=1:noprint_wrappers=1", p],
        capture_output=True, text=True).stdout.strip()
    try:
        n, d = r.split("/"); return round(float(n) / float(d), 3)
    except Exception:
        return 24.0

def alpha_bbox(alpha_np, pad=0.08):
    ys, xs = np.where(alpha_np > 30)
    if len(xs) == 0:
        return None
    x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = x2 - x1, y2 - y1
    return np.array([[x1 - w * pad, y1 - h * pad, x2 + w * pad, y2 + h * pad]], dtype=np.float32)

clips = sorted(glob.glob(os.path.join(CLIP_DIR, "*.mp4")))
# skip derivative sidecar videos (.depth.mp4 / .normal.mp4) — only source clips
clips = [c for c in clips if not c.endswith((".depth.mp4", ".normal.mp4"))]
print(f"{len(clips)} clips -> {OUT_DIR}")
for ci, cp in enumerate(clips):
    stem = os.path.splitext(os.path.basename(cp))[0]
    outp = os.path.join(OUT_DIR, f"{stem}.npz")
    if os.path.exists(outp):
        print(f"[{ci+1}/{len(clips)}] {stem}: exists, skip"); continue
    t0 = time.time()
    fps = ffprobe_fps(cp)
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", cp, os.path.join(td, "r_%04d.png")], check=True)
        raws = sorted(glob.glob(os.path.join(td, "r_*.png")))
        acc = {k: [] for k in KEYS}
        valid = []
        W = H = 0
        n_err = 0
        mid = len(raws) // 2
        for i, rp in enumerate(raws):
            im = Image.open(rp).convert("RGB"); w, h = im.size; hh = h // 2
            color = im.crop((0, 0, w, hh)); alpha = im.crop((0, hh, w, h)).convert("L")
            rgba = color.convert("RGBA"); rgba.putalpha(alpha)
            flat = Image.alpha_composite(Image.new("RGBA", (w, hh), (235, 235, 235, 255)), rgba).convert("RGB")
            W, H = w, hh
            fp = os.path.join(td, f"c_{i:04d}.png"); flat.save(fp)
            bb = alpha_bbox(np.array(alpha))
            ok = False
            if bb is not None:
                try:
                    outs = est.process_one_image(fp, bboxes=bb)
                    o = outs[0]
                    for k in KEYS:
                        acc[k].append(np.asarray(o[k]))
                    ok = True
                    if i == mid and _CAN_RENDER:
                        rend = visualize_sample_together(cv2.imread(fp), outs, est.faces)
                        cv2.imwrite(os.path.join(REND_DIR, f"{stem}.jpg"), rend.astype(np.uint8))
                except Exception as e:
                    n_err += 1
                    print(f"  {stem} f{i} ERR {type(e).__name__}: {e}")
            if not ok:
                for k in KEYS:
                    acc[k].append(None)
            valid.append(ok)
        # stack: fill None with zeros of the per-key template shape
        F = len(raws)
        stacked = {}
        for k in KEYS:
            tmpl = next((a for a in acc[k] if a is not None), None)
            if tmpl is None:
                continue
            arr = np.zeros((F,) + tmpl.shape, dtype=np.float32)
            for i, a in enumerate(acc[k]):
                if a is not None:
                    arr[i] = a
            stacked[k] = arr
        np.savez_compressed(outp, fps=np.float32(fps), frames=np.int32(F),
                            W=np.int32(W), H=np.int32(H), valid=np.array(valid, dtype=bool), **stacked)
    print(f"[{ci+1}/{len(clips)}] {stem}: {len(raws)}f, {n_err} err, {time.time()-t0:.0f}s -> {outp}")
print("ALL DONE")
