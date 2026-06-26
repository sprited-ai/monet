#!/usr/bin/env python3
"""Matte a SCAIL-2 output to an alpha video (BiRefNet) — RUNS ON GIN (ComfyUI 8188).

Output is a grayscale video where luma = opacity (white fg on black). Pair it with the
color video via ffmpeg vstack to get docs/008 stacked-alpha (color top / alpha bottom).
Input mp4 must be in ComfyUI/input/.

  python3 matte_scail2.py --video scail2_monet_e1b_quality_00001.mp4 --w 640 --h 640 --prefix scail2_monet_e1b_alpha
"""
import argparse, json, time, urllib.request, urllib.error
COMFY = "http://127.0.0.1:8188"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--w", type=int, default=640); p.add_argument("--h", type=int, default=640)
    p.add_argument("--fps", type=int, default=16)
    p.add_argument("--prefix", default="scail2_alpha")
    a = p.parse_args()
    g = {}
    def n(i, c, ins): g[i] = {"class_type": c, "inputs": ins}
    n("1", "VHS_LoadVideo", {"video": a.video, "force_rate": 0, "custom_width": 0,
                             "custom_height": 0, "frame_load_cap": 0, "skip_first_frames": 0,
                             "select_every_nth": 1})
    n("2", "LoadRembgByBiRefNetModel", {"model": "General.safetensors", "device": "AUTO"})
    n("3", "GetMaskByBiRefNet", {"model": ["2", 0], "images": ["1", 0], "width": a.w,
                                 "height": a.h, "upscale_method": "bilinear", "mask_threshold": 0.0})
    n("4", "MaskToImage", {"mask": ["3", 0]})
    n("5", "VHS_VideoCombine", {"images": ["4", 0], "frame_rate": a.fps, "loop_count": 0,
                               "filename_prefix": a.prefix, "format": "video/h264-mp4",
                               "pix_fmt": "yuv420p", "crf": 12, "save_output": True,
                               "pingpong": False, "save_metadata": True})
    req = urllib.request.Request(COMFY + "/prompt", data=json.dumps({"prompt": g}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        print("[HTTP %d] %s" % (e.code, e.read().decode())); return
    print("[queued]", pid, flush=True)
    t0 = time.time()
    while time.time() - t0 < 1200:
        time.sleep(4)
        try: h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}", timeout=30))
        except Exception: continue
        if pid in h:
            st = h[pid]["status"]
            print(f"[done] {time.time()-t0:.0f}s {st.get('status_str')}", flush=True)
            for o in h[pid].get("outputs", {}).values():
                for v in o.get("gifs", []) + o.get("videos", []):
                    print("[output]", v.get("filename"), flush=True)
            if st.get("status_str") == "error":
                for m in st.get("messages", []): print("[err]", m, flush=True)
            return
    print("[timeout]")

if __name__ == "__main__":
    main()
