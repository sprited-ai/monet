# Pose-overlay videos: load models once, for each webm extract frames, run pose
# estimation per frame, draw the skeleton overlay, re-encode to a webm.
# Usage:
#   TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 python -m _scripts.pose_webm OUT_DIR IN.webm [IN.webm ...]

from _util.util_v1 import * ; import _util.util_v1 as uutil
from _util.pytorch_v1 import * ; import _util.pytorch_v1 as utorch
from _util.twodee_v0 import * ; import _util.twodee_v0 as u2d
import _util.keypoints_v0 as ukey
import subprocess, tempfile, glob, time

out_dir = sys.argv[1]
in_paths = sys.argv[2:]
fn_model = './_train/character_pose_estim/runs/feat_concat+data.ckpt'
os.makedirs(out_dir, exist_ok=True)

######################## MODELS (loaded once) ########################
from _train.character_bg_seg.models.alaska import Model as CharacterBGSegmenter
model_segmenter = CharacterBGSegmenter.load_from_checkpoint(
    './_train/character_bg_seg/runs/eyeless_alaska_vulcan0000/checkpoints/'
    'epoch=0096-val_f1=0.9508-val_loss=0.0483.ckpt'
)
from _train.character_pose_estim.models.passup import Model as CharacterPoseEstimator
model_pose = CharacterPoseEstimator.load_from_checkpoint(fn_model, strict=False)
model_segmenter.eval(); model_pose.eval()

def abbox(img, thresh=0.5, allow_empty=False):
    img = I(img).np()
    a = img[-1] > thresh
    xlim = np.any(a, axis=1).nonzero()[0]; ylim = np.any(a, axis=0).nonzero()[0]
    if len(xlim)==0 and allow_empty: xlim = np.asarray([0, a.shape[0]])
    if len(ylim)==0 and allow_empty: ylim = np.asarray([0, a.shape[1]])
    axmin,axmax = max(int(xlim.min()-1),0), min(int(xlim.max()+1),a.shape[0])
    aymin,aymax = max(int(ylim.min()-1),0), min(int(ylim.max()+1),a.shape[1])
    return [(axmin,aymin), (axmax-axmin,aymax-aymin)]

def infer_one(img, smoothing=0.1, pad_factor=1):
    # img: an I() RGB image. returns (bbox, keypoints)
    _size = model_segmenter.hparams.largs.bg_seg.size
    simg = I(img).resize_min(_size).convert('RGBA').alpha_bg(1).convert('RGB').pil()
    timg = TF.to_tensor(simg)[None].to(model_segmenter.device)
    with torch.no_grad():
        out = model_segmenter(timg)
    seg = TF.to_pil_image(out['softmax'][0,1].float().cpu()).resize(img.size[::-1])
    bbox = abbox(I(seg), thresh=0.5, allow_empty=True)

    try: largs = model_pose.hparams.largs.adds_keypoints
    except: largs = model_pose.hparams.largs.danbooru_coco
    _s = largs.size; _p = _s * largs.padding
    cb = u2d.cropbox_sequence([
        [bbox[0], bbox[1], bbox[1]],
        resize_square_dry(bbox[1], _s),
        [-_p*pad_factor/2, _s+_p*pad_factor, _s],
    ])
    icb = u2d.cropbox_inverse(img.size, *cb)
    cimg = u2d.cropbox(img, *cb).convert('RGBA').alpha(0).convert('RGB')
    pt = cimg.tensor()[None].to(model_pose.device)
    with torch.no_grad():
        pout = model_pose(pt, smoothing=smoothing, return_more=True)
    kps = pout['keypoints'][0].cpu().numpy()
    kps = u2d.cropbox_points(kps, *icb)
    return bbox, kps

def draw(img, bbox, kps):
    v = I(img)
    for (a,b),c in zip(ukey.coco_parts, ukey.coco_part_colors):
        v = v.line(kps[a], kps[b], w=5, c=c)
    for kp in kps[:len(ukey.coco_keypoints)]:
        v = v.dot(kp, s=5, c='r')
    return v

def ffprobe_fps(p):
    r = subprocess.run(['ffprobe','-v','error','-select_streams','v:0',
        '-show_entries','stream=r_frame_rate','-of','default=nokey=1:noprint_wrappers=1', p],
        capture_output=True, text=True).stdout.strip()
    n,d = r.split('/') if '/' in r else (r,'1')
    return f'{n}/{d}'

def encode(frames_glob, fps, outp):
    # AV1-in-webm (this ffmpeg build lacks libvpx); plays in Chrome/modern browsers.
    r = subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate',fps,
        '-i', frames_glob,
        '-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
        '-c:v','libsvtav1','-crf','35','-preset','8', outp],
        capture_output=True, text=True)
    if r.returncode != 0:
        print(f'  ffmpeg-encode rc={r.returncode}: {r.stderr.strip()[-500:]}')
    return r.returncode == 0

for p in in_paths:
    t0 = time.time()
    stem = os.path.splitext(os.path.basename(p))[0]
    fps = ffprobe_fps(p)
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',p,
            os.path.join(td,'f_%04d.png')], check=True)
        frames = sorted(glob.glob(os.path.join(td,'f_*.png')))
        # persistent overlay-frame dir so a failed encode can be retried cheaply
        odir = os.path.join(out_dir, f'{stem}__frames'); os.makedirs(odir, exist_ok=True)
        have = len(glob.glob(os.path.join(odir,'o_*.png')))
        if have == len(frames) and have > 0:
            print(f'  ({stem}: reusing {have} cached overlay frames, skipping inference)')
        else:
            for i,fr in enumerate(frames):
                img = I(fr).convert('RGBA').alpha_bg(1).convert('RGB')
                try:
                    bbox,kps = infer_one(img)
                    draw(img, bbox, kps).convert('RGB').save(os.path.join(odir, f'o_{i:04d}.png'))
                except Exception as e:
                    I(img).convert('RGB').save(os.path.join(odir, f'o_{i:04d}.png'))
                    print(f'  frame {i} ERR {type(e).__name__}: {e}')
        outp = os.path.join(out_dir, f'{stem}__pose.webm')
        ok = encode(os.path.join(odir,'o_%04d.png'), fps, outp)
    print(f'{"OK " if ok else "ENC-FAIL"}  {p}  ({len(frames)} frames, {time.time()-t0:.0f}s) -> {outp}')
print('done')
