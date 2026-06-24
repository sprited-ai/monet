# Export the SAM-3D-Body NPZs -> slim per-clip JSON the browser can fetch.
# Only the 2D keypoints (70, normalized 0..1 to the color frame) — what the /preview
# "x-ray A" overlay draws. Skeleton edges/colors live in the JS (Stage.tsx, from mhr70).
# Run from repo root:  scripts/.venv/bin/python experiments/sam3d-body/export_s3body_json.py
import numpy as np, glob, os, json

SRC = "experiments/sam3d-body/out"
DEST = "contents/monet"
n = 0
for f in sorted(glob.glob(SRC + "/*.npz")):
    stem = os.path.basename(f)[:-4]
    d = np.load(f)
    kp = d["pred_keypoints_2d"]  # (F, 70, 2) px
    W, H, F, fps = int(d["W"]), int(d["H"]), int(d["frames"]), float(d["fps"])
    valid = d["valid"]
    poses = []
    for i in range(F):
        if not bool(valid[i]):
            poses.append(None); continue
        poses.append([[round(float(x) / W, 5), round(float(y) / H, 5)] for x, y in kp[i]])
    doc = {"clip": stem, "fps": round(fps, 3), "frames": F, "w": W, "h": H, "n_kp": 70, "kp": poses}
    json.dump(doc, open(os.path.join(DEST, stem + ".s3body.json"), "w"), separators=(",", ":"))
    n += 1
print(f"wrote {n} s3body.json")
