import sys, time, numpy as np, cv2, PIL.Image
from anime_face_detector import create_detector
mp4 = sys.argv[1]; frame_idxs=[int(x) for x in sys.argv[2:]] or [1,30,60,90,120]
cap=cv2.VideoCapture(mp4)
det=create_detector("faster-rcnn",device="cpu")
rows=[]
for fi in frame_idxs:
    cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
    ok,frame=cap.read()
    if not ok: continue
    H=frame.shape[0]//2; rgb=frame[:H]                       # top half = RGB char (BGR, black bg)
    matte=frame[H:,:,0]
    al=(matte.astype(np.float32)/255)[...,None]
    onwhite=(rgb*al+255*(1-al)).astype(np.uint8)             # char on white
    kp=np.asarray(max(det(onwhite),key=lambda d:d["bbox"][4])["keypoints"])
    mpts=kp[[24,25,26,27],:2].astype(np.int32)               # mouth landmarks
    m=np.zeros(onwhite.shape[:2],np.uint8); cv2.fillConvexPoly(m,cv2.convexHull(mpts),255)
    pad=max(6,onwhite.shape[0]//45); m=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(pad,pad)))
    # --- fast/dumb inpaint timing ---
    t=time.time(); telea=cv2.inpaint(onwhite,m,3,cv2.INPAINT_TELEA); dt_telea=(time.time()-t)*1000
    t=time.time(); ns=cv2.inpaint(onwhite,m,3,cv2.INPAINT_NS); dt_ns=(time.time()-t)*1000
    print(f"frame {fi:3d}: telea {dt_telea:.2f}ms  ns {dt_ns:.2f}ms  mask_px {int((m>0).sum())}")
    # build a row: [onwhite | mask-overlay | telea]
    ov=onwhite.copy(); ov[m>0]=[0,0,255]
    row=np.hstack([onwhite, ov, telea])
    rows.append(cv2.resize(row,(row.shape[1]//2,row.shape[0]//2)))
out=np.vstack(rows)
cv2.imwrite("/tmp/mouth_inpaint_test.jpg", out, [cv2.IMWRITE_JPEG_QUALITY,92])
print("saved /tmp/mouth_inpaint_test.jpg  (cols: original | mask | telea-inpaint)")
