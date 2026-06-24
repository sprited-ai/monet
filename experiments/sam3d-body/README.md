# SAM-3D-Body rig over Monet's clips

Running Meta's [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) over every
Monet clip to extract a per-frame **rig** — 2D/3D keypoints, 127-joint coordinates +
global rotation matrices, hand pose, and hand boxes.

## Why (and the catch)

The **3D body mesh does NOT fit Monet** — MHR is a real adult-human parametric model and
can't represent her 3-head-tall chibi proportions (see memory `sam-3d-body-not-for-monet`).
But the **rig / keypoint estimation is excellent — especially hands** (full finger
articulation, which the 2D bizarre-pose-estimator lacks). So we keep the rig, drop the mesh.

The ViTDet person detector can't even find the chibi, so we **bypass detection**: a tight
per-frame bbox from the clip's own **alpha** (stacked-alpha mp4: color top / alpha-as-luma
bottom), composite the color half on neutral gray (`235`), and feed `(image, bbox)` straight
to `estimator.process_one_image(..., bboxes=...)`. Every frame fits (valid 121/121).

## Run (on `gin`, the Blackwell GPU box)

```bash
# env at ~/dev/sam-3d-body (uv venv, torch cu128, detectron2, dinov3 ckpt — see the memory)
cd ~/dev/sam-3d-body && source .venv/bin/activate
python sam3d_batch.py        # reads monet_clips/*.mp4 -> sam3d_out/<clip>.npz (+ renders/<clip>.jpg)
```

## Output — `out/<clip>.npz` (one per clip, float32, compressed ~0.85 MB)

Per-frame arrays (F = frame count, coords in the **640×640 color-frame pixel space**):

| key | shape | meaning |
|---|---|---|
| `pred_keypoints_2d` | (F, 70, 2) | 70 keypoints (body + hands + face), image px |
| `pred_keypoints_3d` | (F, 70, 3) | same joints in 3D (model units) |
| `pred_joint_coords` | (F, 127, 3) | full MHR skeleton, 3D |
| `pred_global_rots` | (F, 127, 3, 3) | **per-joint global rotation matrices = the animation rig** |
| `hand_pose_params` | (F, 108) | hand articulation |
| `body_pose_params` | (F, 133) | body pose |
| `global_rot` `pred_cam_t` `focal_length` | (F,3) (F,3) (F,) | root orientation + weak-perspective camera |
| `scale_params` `shape_params` `expr_params` | (F,28) (F,45) (F,72) | MHR scale / shape / face-expression |
| `lhand_bbox` `rhand_bbox` `bbox` | (F,4) each | hand boxes + the body bbox we fed |
| `valid` | (F,) bool | frame fit ok (failed frames zero-filled) |
| `fps` `frames` `W` `H` | scalars | clip metadata |

`out/renders/<clip>.jpg` — mid-frame overlay (input · 2D keypoints · mesh · mesh-only) for QA.

`pred_vertices` (18k-vert mesh) is intentionally NOT stored — regenerable from the params,
and the mesh doesn't fit her anyway.
