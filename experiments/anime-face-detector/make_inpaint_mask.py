import sys, numpy as np, cv2, PIL.Image
from anime_face_detector import create_detector
src, dst = sys.argv[1], sys.argv[2]
pil = PIL.Image.open(src).convert("RGBA"); rgba=np.array(pil)
bgr = cv2.cvtColor(rgba[:,:,:3], cv2.COLOR_RGB2BGR)
det = create_detector("faster-rcnn", device="cpu")
p = max(det(bgr), key=lambda d: d["bbox"][4]); kp=np.asarray(p["keypoints"])
H,W = rgba.shape[:2]; m=np.zeros((H,W),np.uint8)
diag=int(np.hypot(H,W)); pad=max(8, diag//90)
groups={"eyes":list(range(11,23)),"nose":[23],"mouth":[24,25,26,27],"brows":list(range(5,11))}
for part,idx in groups.items():
    pts=kp[idx,:2].astype(np.int32)
    if len(pts)>=3: cv2.fillConvexPoly(m, cv2.convexHull(pts), 255)
    else:
        for q in pts: cv2.circle(m, tuple(q), pad, 255, -1)
m=cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(pad,pad)))
PIL.Image.fromarray(m).save(dst)
print("mask ->", dst, "white px:", int((m>0).sum()))
