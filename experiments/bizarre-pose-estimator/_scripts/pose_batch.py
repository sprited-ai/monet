# Batch pose estimation: load models once, process many images, save overlays.
# Adapted from _scripts/pose_estimator.py.
# Usage:
#   TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 python -m _scripts.pose_batch OUT_DIR IMG [IMG ...]

from _util.util_v1 import * ; import _util.util_v1 as uutil
from _util.pytorch_v1 import * ; import _util.pytorch_v1 as utorch
from _util.twodee_v0 import * ; import _util.twodee_v0 as u2d
import _util.keypoints_v0 as ukey

out_dir = sys.argv[1]
img_paths = sys.argv[2:]
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

def abbox(img, thresh=0.5, allow_empty=False):
    img = I(img).np()
    assert len(img) in [1,4], 'image must be mode L or RGBA'
    a = img[-1] > thresh
    xlim = np.any(a, axis=1).nonzero()[0]
    ylim = np.any(a, axis=0).nonzero()[0]
    if len(xlim)==0 and allow_empty: xlim = np.asarray([0, a.shape[0]])
    if len(ylim)==0 and allow_empty: ylim = np.asarray([0, a.shape[1]])
    axmin,axmax = max(int(xlim.min()-1),0), min(int(xlim.max()+1),a.shape[0])
    aymin,aymax = max(int(ylim.min()-1),0), min(int(ylim.max()+1),a.shape[1])
    return [(axmin,aymin), (axmax-axmin,aymax-aymin)]

def infer_segmentation(self, images, bbox_thresh=0.5):
    anss = []
    _size = self.hparams.largs.bg_seg.size
    self.eval()
    for img in images:
        oimg = img
        img = I(img).resize_min(_size).convert('RGBA').alpha_bg(1).convert('RGB').pil()
        timg = TF.to_tensor(img)[None].to(self.device)
        with torch.no_grad():
            out = self(timg)
        ans = TF.to_pil_image(out['softmax'][0,1].float().cpu()).resize(oimg.size[::-1])
        ans = {'segmentation': I(ans)}
        ans['bbox'] = abbox(ans['segmentation'], thresh=bbox_thresh, allow_empty=True)
        anss.append(ans)
    return anss

def infer_pose(self, segmenter, images, smoothing=0.1, pad_factor=1):
    self.eval()
    try: largs = self.hparams.largs.adds_keypoints
    except: largs = self.hparams.largs.danbooru_coco
    _s = largs.size
    _p = _s * largs.padding
    anss = []
    segs = infer_segmentation(segmenter, images)
    for img,seg in zip(images,segs):
        oimg = img
        ans = {'segmentation_output': seg}
        bbox = seg['bbox']
        cb = u2d.cropbox_sequence([
            [bbox[0], bbox[1], bbox[1]],
            resize_square_dry(bbox[1], _s),
            [-_p*pad_factor/2, _s+_p*pad_factor, _s],
        ])
        icb = u2d.cropbox_inverse(oimg.size, *cb)
        img = u2d.cropbox(img, *cb)
        img = img.convert('RGBA').alpha(0).convert('RGB')
        ans['bbox'] = bbox; ans['cropbox'] = cb; ans['cropbox_inverse'] = icb
        timg = img.tensor()[None].to(self.device)
        with torch.no_grad():
            out = self(timg, smoothing=smoothing, return_more=True)
        kps = out['keypoints'][0].cpu().numpy()
        kps = u2d.cropbox_points(kps, *icb)
        ans['keypoints'] = kps
        anss.append(ans)
    return anss

def _visualize(image=None, bbox=None, keypoints=None):
    v = image
    if bbox is not None: v = v.rect(*bbox, c='r', w=3)
    if keypoints is not None:
        for (a,b),c in zip(ukey.coco_parts, ukey.coco_part_colors):
            v = v.line(keypoints[a], keypoints[b], w=6, c=c)
        for kp in keypoints[:len(ukey.coco_keypoints)]:
            v = v.dot(kp, s=6, c='r')
    return v

######################## LOOP ########################
for p in img_paths:
    try:
        img = I(p).convert('RGBA').alpha_bg(1).convert('RGB')  # flatten transparency on white
        ans = infer_pose(model_pose, model_segmenter, [img,])[0]
        stem = os.path.splitext(os.path.basename(p))[0]
        outp = os.path.join(out_dir, f'{stem}__pose.png')
        _visualize(img, ans['bbox'], ans['keypoints']).save(outp)
        print(f'OK  {p} -> {outp}')
    except Exception as e:
        print(f'ERR {p}: {type(e).__name__}: {e}')
print('done')
