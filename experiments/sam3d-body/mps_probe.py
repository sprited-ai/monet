#!/usr/bin/env python
"""MPS feasibility probe — load SAM-3D-Body on Apple GPU, run ONE frame, report the
first op that breaks (or success + timing). Scout for an eventual sprited-ai MPS port.

Run from ~/dev/sam-3d-body with PYTHONPATH=. and (intentionally) MPS fallback OFF so a
missing op surfaces by name instead of silently routing to CPU:

  PYTORCH_ENABLE_MPS_FALLBACK=0 PYTHONPATH=. .venv/bin/python <repo>/experiments/sam3d-body/mps_probe.py <clip.mp4>
"""
import os, sys, time, tempfile, traceback
import numpy as np, cv2, torch
from PIL import Image
from sam_3d_body import load_sam_3d_body, SAM3DBodyEstimator

CKPT = os.environ.get("SAM3D_CKPT_DIR", "checkpoints/sam-3d-body-dinov3")
clip = sys.argv[1]
dev = os.environ.get("PROBE_DEVICE", "mps")
print(f"torch {torch.__version__}  mps_available={torch.backends.mps.is_available()}  "
      f"fallback={os.environ.get('PYTORCH_ENABLE_MPS_FALLBACK','?')}")

# --- frame 0, composited like the batch (color top + alpha bottom on gray 235) ---
cap = cv2.VideoCapture(clip); ok, f = cap.read(); cap.release()
h2, w = f.shape[:2]; h = h2 // 2
color = cv2.cvtColor(f[:h, :w], cv2.COLOR_BGR2RGB)
alpha = cv2.cvtColor(f[h:, :w], cv2.COLOR_BGR2GRAY)
rgba = np.dstack([color, alpha])
im = Image.fromarray(rgba, "RGBA")
flat = Image.alpha_composite(Image.new("RGBA", (w, h), (235, 235, 235, 255)), im).convert("RGB")
td = tempfile.mkdtemp(); fp = os.path.join(td, "f0.png"); flat.save(fp)
ys, xs = np.where(alpha > 30)
x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
pw, ph = (x2 - x1) * 0.08, (y2 - y1) * 0.08
bb = np.array([[x1 - pw, y1 - ph, x2 + pw, y2 + ph]], dtype=np.float32)

print("loading model on mps ...")
t0 = time.time()
model, cfg = load_sam_3d_body(f"{CKPT}/model.ckpt", device=dev, mhr_path=f"{CKPT}/assets/mhr_model.pt")
est = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=cfg,
                         human_detector=None, human_segmentor=None, fov_estimator=None)
print(f"  model loaded in {time.time()-t0:.1f}s")

print("running process_one_image on 1 frame ...")
t1 = time.time()
try:
    outs = est.process_one_image(fp, bboxes=bb)
    dt = time.time() - t1
    o = outs[0]
    kp = np.asarray(o["pred_keypoints_2d"])
    print(f"\n✅ SUCCESS on {dev} — 1 frame in {dt:.2f}s")
    print(f"   pred_keypoints_2d shape {kp.shape}, sample nose px = {kp[0]}")
    print(f"   (gin GPU ≈ 0.04s/frame; estimate {dev} clip ×121 ≈ {dt*121:.0f}s)")
except Exception as e:
    print(f"\n❌ BROKE after {time.time()-t1:.2f}s — first MPS gap:")
    print(f"   {type(e).__name__}: {e}")
    tb = traceback.format_exc().strip().splitlines()
    print("   " + "\n   ".join(tb[-6:]))
