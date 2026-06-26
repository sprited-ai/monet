# Batch pose-DATA extraction over Monet's stacked-alpha clips.
#
# Unlike exp_monet_pose (which draws skeletons into a video), this SAVES the
# keypoint numbers as JSON — one file per clip — so downstream code (the
# whiteroom ShadowNode, a /preview skeleton-overlay toggle) can consume them.
#
# Coords are normalized 0..1 to the COLOR (top-half) frame, so they're
# independent of render scale and map straight onto the sprite's visible region.
#
# Per-frame derived fields (mask-based, robust — the pose keypoints are noisy on
# this chibi character, so derived anchors come from the segmentation mask):
#   com  = full center of mass  -> contact-shadow x (renderer smooths over time)
#   face = head-region centroid -> camera zoom-to-face target
# Raw pose keypoints (kp) + bbox are kept for overlays / future refinement.
#
# Usage (from experiments/bizarre-pose-estimator/):
#   TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 ../../scripts/.venv/bin/python \
#       -m _scripts.pose_data OUT_DIR CLIP.mp4 [CLIP.mp4 ...]
#   # or a whole dir:
#   ... -m _scripts.pose_data OUT_DIR --glob /path/to/contents/monet/'*.mp4'
#
# Re-running skips clips whose JSON already exists (resume-friendly).

from _util.util_v1 import * ; import _util.util_v1 as uutil
from _util.pytorch_v1 import * ; import _util.pytorch_v1 as utorch
from _util.twodee_v0 import * ; import _util.twodee_v0 as u2d
import _util.keypoints_v0 as ukey
import subprocess, tempfile, glob, time, json
from PIL import Image

# ---- args ----
out_dir = sys.argv[1]
rest = sys.argv[2:]
if rest and rest[0] == '--glob':
    in_paths = sorted(glob.glob(rest[1]))
else:
    in_paths = rest
# skip derivative sidecar videos (.depth.mp4 / .normal.mp4) — only source clips
in_paths = [p for p in in_paths if not p.endswith(('.depth.mp4', '.normal.mp4'))]
os.makedirs(out_dir, exist_ok=True)

CKPT = './_train/character_pose_estim/runs/feat_concat+data.ckpt'
MODEL_NAME = 'feat_concat+data'

# Cap intra-op threads so N parallel workers don't oversubscribe the cores.
_THREADS = int(os.environ.get('POSE_THREADS', '0'))
if _THREADS:
    torch.set_num_threads(_THREADS)

# keypoint names (pad if model emits more channels than we have names for)
def kp_names(n):
    names = list(ukey.coco_keypoints_ext)
    return [names[i] if i < len(names) else f'kp_{i}' for i in range(n)]

######################## models (loaded once) ########################
from _train.character_bg_seg.models.alaska import Model as Seg
model_seg = Seg.load_from_checkpoint(
    './_train/character_bg_seg/runs/eyeless_alaska_vulcan0000/checkpoints/'
    'epoch=0096-val_f1=0.9508-val_loss=0.0483.ckpt')
from _train.character_pose_estim.models.passup import Model as Pose
model_pose = Pose.load_from_checkpoint(CKPT, strict=False)
model_seg.eval(); model_pose.eval()

######################## stacked-alpha frame prep ########################
def extract_prepped(in_path, td):
    raw = os.path.join(td, 'raw_%04d.png')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',in_path, raw], check=True)
    paths = sorted(glob.glob(os.path.join(td,'raw_*.png')))
    prepped = []
    for i,p in enumerate(paths):
        im = Image.open(p).convert('RGB')
        w,h = im.size; hh = h//2
        color = im.crop((0,0,w,hh))
        alpha = im.crop((0,hh,w,h)).convert('L')
        rgba = color.convert('RGBA'); rgba.putalpha(alpha)
        # Composite onto NEUTRAL GRAY 0x808080 (not white): the color top-half holds
        # garbage RGB wherever alpha=0, and semi-transparent edges blend it into the
        # background. Gray keeps that junk neutral (no false edges, no confusion with
        # white character parts), so the segmenter/pose model see no meaningless signal.
        bg = Image.new('RGBA',(w,hh),(128,128,128,255))
        flat = Image.alpha_composite(bg, rgba).convert('RGB')
        op = os.path.join(td, f'prep_{i:04d}.png'); flat.save(op); prepped.append(op)
    return prepped

######################## inference ########################
def abbox(img, thresh=0.5):
    a = I(img).np()[-1] > thresh
    xl = np.any(a,axis=1).nonzero()[0]; yl = np.any(a,axis=0).nonzero()[0]
    if len(xl)==0: xl=np.asarray([0,a.shape[0]])
    if len(yl)==0: yl=np.asarray([0,a.shape[1]])
    return [(max(int(xl.min()-1),0),max(int(yl.min()-1),0)),
            (min(int(xl.max()+1),a.shape[0])-max(int(xl.min()-1),0),
             min(int(yl.max()+1),a.shape[1])-max(int(yl.min()-1),0))]

def mask_anchors(mass):
    # mass: (H,W) foreground-probability mask. Returns (com, face), each [x,y]
    # normalized 0..1 to the frame (mask aspect == color-frame aspect).
    #   com  = full center of mass        -> shadow x (renderer smooths over time)
    #   face = head-region centroid       -> camera zoom-to-face target
    H, W = mass.shape
    total = float(mass.sum()) or 1.0
    colm = mass.sum(0); rowm = mass.sum(1)
    com = [float((colm*np.arange(W)).sum()/total)/W,
           float((rowm*np.arange(H)).sum()/total)/H]
    # head = top 45% of the occupied vertical extent (chibi head is large)
    occ = np.where(rowm > rowm.max()*0.05)[0]
    r0, r1 = (int(occ.min()), int(occ.max())) if len(occ) else (0, H-1)
    band = r0 + int((r1-r0)*0.45)
    top = mass.copy(); top[band:,:] = 0
    tt = float(top.sum()) or 1.0
    face = [float((top.sum(0)*np.arange(W)).sum()/tt)/W,
            float((top.sum(1)*np.arange(H)).sum()/tt)/H]
    return com, face

def infer_one(img, smoothing=0.1, pad_factor=1):
    # returns (bbox [(x,y),(w,h)] px (row,col order), kps Nx2 px, scores N, com, face)
    _size = model_seg.hparams.largs.bg_seg.size
    simg = I(img).resize_min(_size).convert('RGBA').alpha_bg(1).convert('RGB').pil()
    with torch.no_grad():
        out = model_seg(TF.to_tensor(simg)[None].to(model_seg.device))
    mass = out['softmax'][0,1].float().cpu().numpy()
    com, face = mask_anchors(mass)
    smask = TF.to_pil_image(out['softmax'][0,1].float().cpu()).resize(img.size[::-1])
    bbox = abbox(I(smask))
    try: largs = model_pose.hparams.largs.adds_keypoints
    except: largs = model_pose.hparams.largs.danbooru_coco
    _s = largs.size; _p = _s*largs.padding
    cb = u2d.cropbox_sequence([[bbox[0],bbox[1],bbox[1]],
        resize_square_dry(bbox[1],_s),[-_p*pad_factor/2,_s+_p*pad_factor,_s]])
    icb = u2d.cropbox_inverse(img.size,*cb)
    cimg = u2d.cropbox(img,*cb).convert('RGBA').alpha(0).convert('RGB')
    with torch.no_grad():
        pout = model_pose(cimg.tensor()[None].to(model_pose.device),
                          smoothing=smoothing, return_more=True)
    kps = u2d.cropbox_points(pout['keypoints'][0].cpu().numpy(), *icb)
    # per-keypoint score = peak of its (smoothed) probability heatmap
    scores = pout['keypoint_heatmaps_prob'][0].amax(dim=(-2,-1)).cpu().numpy()
    return bbox, kps, scores, com, face

def ffprobe_fps(p):
    r = subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries',
        'stream=r_frame_rate','-of','default=nokey=1:noprint_wrappers=1',p],
        capture_output=True,text=True).stdout.strip()
    try:
        n,d = r.split('/'); return round(float(n)/float(d), 3)
    except Exception:
        return None

######################## batch ########################
print(f'{len(in_paths)} clip(s) -> {out_dir}')
for ci, p in enumerate(in_paths):
    stem = os.path.splitext(os.path.basename(p))[0]
    outp = os.path.join(out_dir, f'{stem}.bizarre.json')
    if os.path.exists(outp):
        print(f'[{ci+1}/{len(in_paths)}] {stem}: exists, skip'); continue
    t0 = time.time()
    with tempfile.TemporaryDirectory() as td:
        frames = extract_prepped(p, td)
        if not frames:
            print(f'[{ci+1}/{len(in_paths)}] {stem}: NO FRAMES, skip'); continue
        w, h = Image.open(frames[0]).size
        poses, n_err = [], 0
        for i, f in enumerate(frames):
            try:
                bbox, kps, scores, com, face = infer_one(I(f).convert('RGB'))
                # library kps are (row,col)=(y,x); store conventional (x,y) normalized
                kp = [[round(float(c)/w,5), round(float(r)/h,5), round(float(s),4)]
                      for (r,c),s in zip(kps, scores)]
                (rmin,cmin),(rext,cext) = bbox
                poses.append({
                    'bbox': [round(cmin/w,5), round(rmin/h,5), round(cext/w,5), round(rext/h,5)],
                    'com': [round(com[0],5), round(com[1],5)],
                    'face': [round(face[0],5), round(face[1],5)],
                    'kp': kp,
                })
            except Exception as e:
                n_err += 1
                poses.append(None)
                print(f'    frame {i} ERR {type(e).__name__}: {e}')
        doc = {
            'clip': stem,
            'source': f'monet/{os.path.basename(p)}',
            'fps': ffprobe_fps(p),
            'frames': len(frames),
            'width': w, 'height': h,
            'model': MODEL_NAME,
            'prep_bg': '0x808080',
            'coord_space': 'normalized to color (top-half) frame, origin top-left',
            'keypoint_names': kp_names(len(poses[0]['kp']) if poses and poses[0] else 17),
            'fields': {
                'com': 'mask center of mass [x,y] -> contact-shadow x (smooth over time)',
                'face': 'head-region (top 45%) mask centroid [x,y] -> camera zoom-to-face target',
                'bbox': '[x,y,w,h] character bounds; kp: [[x,y,score]...] raw pose keypoints',
            },
            'poses': poses,
        }
        with open(outp, 'w') as fh:
            json.dump(doc, fh, separators=(',',':'))
    dt = time.time()-t0
    print(f'[{ci+1}/{len(in_paths)}] {stem}: {len(frames)} frames, '
          f'{n_err} err, {dt:.0f}s -> {outp}')
print('done')
