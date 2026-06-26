import sys, numpy as np, cv2, PIL.Image
from anime_face_detector import create_detector
src, dst = sys.argv[1], sys.argv[2]
rgba=np.array(PIL.Image.open(src).convert("RGBA"))
bgr=cv2.cvtColor(rgba[:,:,:3],cv2.COLOR_RGB2BGR)
det=create_detector("faster-rcnn",device="cpu")
kp=np.asarray(max(det(bgr),key=lambda d:d["bbox"][4])["keypoints"])
H,W=rgba.shape[:2]; m=np.zeros((H,W),np.uint8)
pad=max(8,int(np.hypot(H,W))//100)
for idx in (list(range(11,17)), list(range(17,23))):  # L eye, R eye separately
    pts=kp[idx,:2].astype(np.int32)
    cv2.fillConvexPoly(m, cv2.convexHull(pts), 255)
m=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(pad,pad)))
PIL.Image.fromarray(m).save(dst); print("eye mask ->",dst,"white px:",int((m>0).sum()))
