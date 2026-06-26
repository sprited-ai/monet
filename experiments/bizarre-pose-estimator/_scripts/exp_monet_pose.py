# Experiment: bizarre-pose-estimator on Monet's STACKED-ALPHA clips.
#
# Monet mp4s pack color on the top half and alpha-as-luma on the bottom half, so
# we split each frame, composite the character on white, then run pose. Three modes:
#
#   options  IN.mp4   -> run all 4 checkpoints on ONE mid-frame, save 4 overlays
#   video    IN.mp4   -> run default ckpt on ALL frames, overlay + encode mp4
#   time     IN.mp4   -> just measure model-load + per-frame latency (live-service Q)
#
# Usage:
#   TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 ../../.venv/bin/python -m _scripts.exp_monet_pose <mode> IN.mp4
#
# Outputs land in ./_samples/exp_monet/.

from _util.util_v1 import * ; import _util.util_v1 as uutil
from _util.pytorch_v1 import * ; import _util.pytorch_v1 as utorch
from _util.twodee_v0 import * ; import _util.twodee_v0 as u2d
import _util.keypoints_v0 as ukey
import subprocess, tempfile, glob, time
from PIL import Image

mode = sys.argv[1]
in_path = sys.argv[2]
out_dir = './_samples/exp_monet'
os.makedirs(out_dir, exist_ok=True)
CKPTS = {
    'feat_concat':      './_train/character_pose_estim/runs/feat_concat.ckpt',
    'feat_concat+data': './_train/character_pose_estim/runs/feat_concat+data.ckpt',
    'feat_match':       './_train/character_pose_estim/runs/feat_match.ckpt',
    'feat_match+data':  './_train/character_pose_estim/runs/feat_match+data.ckpt',
}
DEFAULT = 'feat_concat+data'

######################## stacked-alpha frame prep ########################
def extract_prepped(in_path, td, max_frames=None):
    # ffmpeg dumps raw stacked frames; we split top(color)/bottom(alpha) -> white-bg RGB.
    raw = os.path.join(td, 'raw_%04d.png')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',in_path, raw], check=True)
    paths = sorted(glob.glob(os.path.join(td,'raw_*.png')))
    if max_frames: paths = paths[:max_frames]
    prepped = []
    for i,p in enumerate(paths):
        im = Image.open(p).convert('RGB')
        w,h = im.size; hh = h//2
        color = im.crop((0,0,w,hh))
        alpha = im.crop((0,hh,w,h)).convert('L')
        rgba = color.convert('RGBA'); rgba.putalpha(alpha)
        white = Image.new('RGBA',(w,hh),(255,255,255,255))
        flat = Image.alpha_composite(white, rgba).convert('RGB')
        op = os.path.join(td, f'prep_{i:04d}.png'); flat.save(op); prepped.append(op)
    return prepped

######################## models ########################
def load_segmenter():
    from _train.character_bg_seg.models.alaska import Model as Seg
    m = Seg.load_from_checkpoint(
        './_train/character_bg_seg/runs/eyeless_alaska_vulcan0000/checkpoints/'
        'epoch=0096-val_f1=0.9508-val_loss=0.0483.ckpt')
    m.eval(); return m

def load_pose(ckpt):
    if 'feat_concat' in ckpt:
        from _train.character_pose_estim.models.passup import Model as Pose
    else:
        from _train.character_pose_estim.models.fermat import Model as Pose
    m = Pose.load_from_checkpoint(ckpt, strict=False); m.eval(); return m

def abbox(img, thresh=0.5):
    a = I(img).np()[-1] > thresh
    xl = np.any(a,axis=1).nonzero()[0]; yl = np.any(a,axis=0).nonzero()[0]
    if len(xl)==0: xl=np.asarray([0,a.shape[0]])
    if len(yl)==0: yl=np.asarray([0,a.shape[1]])
    return [(max(int(xl.min()-1),0),max(int(yl.min()-1),0)),
            (min(int(xl.max()+1),a.shape[0])-max(int(xl.min()-1),0),
             min(int(yl.max()+1),a.shape[1])-max(int(yl.min()-1),0))]

def infer_one(seg, pose, img, smoothing=0.1, pad_factor=1):
    _size = seg.hparams.largs.bg_seg.size
    simg = I(img).resize_min(_size).convert('RGBA').alpha_bg(1).convert('RGB').pil()
    with torch.no_grad():
        out = seg(TF.to_tensor(simg)[None].to(seg.device))
    smask = TF.to_pil_image(out['softmax'][0,1].float().cpu()).resize(img.size[::-1])
    bbox = abbox(I(smask))
    try: largs = pose.hparams.largs.adds_keypoints
    except: largs = pose.hparams.largs.danbooru_coco
    _s = largs.size; _p = _s*largs.padding
    cb = u2d.cropbox_sequence([[bbox[0],bbox[1],bbox[1]],
        resize_square_dry(bbox[1],_s),[-_p*pad_factor/2,_s+_p*pad_factor,_s]])
    icb = u2d.cropbox_inverse(img.size,*cb)
    cimg = u2d.cropbox(img,*cb).convert('RGBA').alpha(0).convert('RGB')
    with torch.no_grad():
        pout = pose(cimg.tensor()[None].to(pose.device), smoothing=smoothing, return_more=True)
    kps = u2d.cropbox_points(pout['keypoints'][0].cpu().numpy(), *icb)
    return bbox, kps

def draw(img, bbox, kps, label=None):
    v = I(img)
    for (a,b),c in zip(ukey.coco_parts, ukey.coco_part_colors):
        v = v.line(kps[a], kps[b], w=5, c=c)
    for kp in kps[:len(ukey.coco_keypoints)]:
        v = v.dot(kp, s=5, c='r')
    return v

def ffprobe_fps(p):
    r = subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries',
        'stream=r_frame_rate','-of','default=nokey=1:noprint_wrappers=1',p],
        capture_output=True,text=True).stdout.strip()
    return r if '/' in r else f'{r}/1'

######################## modes ########################
if mode == 'options':
    with tempfile.TemporaryDirectory() as td:
        frames = extract_prepped(in_path, td)
        mid = frames[len(frames)//2]
        img = I(mid).convert('RGB')
        seg = load_segmenter()
        for name,ckpt in CKPTS.items():
            t=time.time(); pose=load_pose(ckpt)
            bbox,kps = infer_one(seg,pose,img)
            op = os.path.join(out_dir, f'options_{name.replace("+","_")}.png')
            draw(img,bbox,kps).convert('RGB').save(op)
            print(f'{name:18s} -> {op}  ({time.time()-t:.1f}s incl load)')
            del pose
    print('done: compare the 4 options_*.png overlays')

elif mode == 'time':
    with tempfile.TemporaryDirectory() as td:
        frames = extract_prepped(in_path, td, max_frames=5)
        t=time.time(); seg=load_segmenter(); pose=load_pose(CKPTS[DEFAULT])
        print(f'model load: {time.time()-t:.1f}s')
        for i,f in enumerate(frames):
            t=time.time(); infer_one(seg,pose,I(f).convert('RGB'))
            print(f'  frame {i}: {time.time()-t:.2f}s')

elif mode == 'video':
    stem = os.path.splitext(os.path.basename(in_path))[0]
    fps = ffprobe_fps(in_path)
    seg=load_segmenter(); pose=load_pose(CKPTS[DEFAULT])
    with tempfile.TemporaryDirectory() as td:
        frames = extract_prepped(in_path, td)
        odir = os.path.join(out_dir, f'{stem}__frames'); os.makedirs(odir,exist_ok=True)
        lat=[]
        for i,f in enumerate(frames):
            t=time.time()
            try:
                bbox,kps = infer_one(seg,pose,I(f).convert('RGB'))
                draw(I(f).convert('RGB'),bbox,kps).convert('RGB').save(os.path.join(odir,f'o_{i:04d}.png'))
            except Exception as e:
                I(f).convert('RGB').save(os.path.join(odir,f'o_{i:04d}.png'))
                print(f'  frame {i} ERR {type(e).__name__}: {e}')
            lat.append(time.time()-t)
            if i%20==0: print(f'  frame {i}/{len(frames)} {lat[-1]:.2f}s')
        outp = os.path.join(out_dir, f'{stem}__pose.mp4')
        subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate',fps,
            '-i',os.path.join(odir,'o_%04d.png'),
            '-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
            '-c:v','libx264','-crf','18',outp], check=True)
        print(f'OK {len(frames)} frames -> {outp}')
        print(f'latency: mean {np.mean(lat):.2f}s  median {np.median(lat):.2f}s  '
              f'-> {1/np.mean(lat):.1f} fps on CPU')
else:
    print('mode must be one of: options | video | time')
