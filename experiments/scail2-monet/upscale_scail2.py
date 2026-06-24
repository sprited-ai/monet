#!/usr/bin/env python3
"""Per-frame anime upscale of a SCAIL-2 output — RUNS ON GIN (ComfyUI 127.0.0.1:8188).

RealESRGAN_x4plus_anime_6B 4x, then lanczos-downscale to a target long side. This
SHARPENS line art but does NOT remove motion blur (per-frame, no temporal model) —
see README "upscale" section. Input mp4 must be copied into ComfyUI/input/ first.

  python3 upscale_scail2.py --video scail2_monet_e1_00001.mp4 --target 1280 --prefix scail2_monet_e1_up
"""
import argparse, json, time, urllib.request, urllib.error
COMFY = "http://127.0.0.1:8188"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--target", type=int, default=1280, help="long side after downscale; 0 = keep 4x")
    p.add_argument("--fps", type=int, default=16)
    p.add_argument("--model", default="RealESRGAN_x4plus_anime_6B.pth")
    p.add_argument("--prefix", default="scail2_up")
    a = p.parse_args()
    g = {}
    def n(i, c, ins): g[i] = {"class_type": c, "inputs": ins}
    n("1", "VHS_LoadVideo", {"video": a.video, "force_rate": 0, "custom_width": 0,
                             "custom_height": 0, "frame_load_cap": 0, "skip_first_frames": 0,
                             "select_every_nth": 1})
    n("2", "UpscaleModelLoader", {"model_name": a.model})
    n("3", "ImageUpscaleWithModel", {"upscale_model": ["2", 0], "image": ["1", 0]})
    last = ["3", 0]
    if a.target > 0:
        n("4", "ImageScale", {"image": ["3", 0], "upscale_method": "lanczos",
                              "width": a.target, "height": a.target, "crop": "disabled"})
        last = ["4", 0]
    n("5", "VHS_VideoCombine", {"images": last, "frame_rate": a.fps, "loop_count": 0,
                               "filename_prefix": a.prefix, "format": "video/h264-mp4",
                               "pix_fmt": "yuv420p", "crf": 16, "save_output": True,
                               "pingpong": False, "save_metadata": True})
    req = urllib.request.Request(COMFY + "/prompt", data=json.dumps({"prompt": g}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        print("[HTTP %d] %s" % (e.code, e.read().decode())); return
    print("[queued]", pid, flush=True)
    t0 = time.time()
    while time.time() - t0 < 1800:
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
