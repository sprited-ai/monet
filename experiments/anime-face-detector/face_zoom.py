import sys, os, cv2, numpy as np
from anime_face_detector import create_detector
HERE=os.path.dirname(os.path.abspath(__file__))
det=create_detector("faster-rcnn",device="cpu")
for path in sys.argv[1:]:
    name=os.path.basename(path).rsplit(".",1)[0]
    orig=cv2.imread(path)
    telea=cv2.imread(f"{HERE}/facewipe/{name}_wiped_telea.png")
    skin=cv2.imread(f"{HERE}/facewipe/{name}_wiped_skin.png")
    p=det(orig)
    if not p: print("noface",name); continue
    x,y,w_,h_,sc=max(p,key=lambda d:d["bbox"][4])["bbox"][:5] if False else (*max(p,key=lambda d:d["bbox"][4])["bbox"],) 
    x0,y0,x1,y1=int(x),int(y),int(w_),int(h_)
    pad=int((x1-x0)*0.35)
    x0=max(0,x0-pad);y0=max(0,y0-pad);x1=min(orig.shape[1],x1+pad);y1=min(orig.shape[0],y1+pad)
    crops=[c[y0:y1,x0:x1] for c in (orig,telea,skin)]
    H=320; crops=[cv2.resize(c,(int(c.shape[1]*H/c.shape[0]),H),interpolation=cv2.INTER_NEAREST) for c in crops]
    gap=np.zeros((H,8,3),np.uint8)+40
    panel=np.hstack([crops[0],gap,crops[1],gap,crops[2]])
    cv2.imwrite(f"{HERE}/facewipe/{name}_zoom.png",panel)
    print("wrote",f"{name}_zoom.png  [orig | telea | skin-fill]")
