#!/usr/bin/env python3
"""RIFE frame-interpolation of a clip — RUNS ON GIN (ComfyUI 127.0.0.1:8188).

Targets temporal judder (fast motion at low fps reads as "blurry"). Doubles frames
and the output fps, so duration is unchanged but motion is smooth. Input mp4 must be
in ComfyUI/input/.

  python3 rife_scail2.py --video scail2_monet_e1_up_00001.mp4 --mult 2 --in_fps 16 --prefix scail2_monet_e1_up_rife
"""
import argparse, json, time, urllib.request, urllib.error
COMFY = "http://127.0.0.1:8188"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--mult", type=int, default=2)
    p.add_argument("--in_fps", type=int, default=16)
    p.add_argument("--ckpt", default="rife42.pth")
    p.add_argument("--prefix", default="scail2_rife")
    a = p.parse_args()
    g = {}
    def n(i, c, ins): g[i] = {"class_type": c, "inputs": ins}
    n("1", "VHS_LoadVideo", {"video": a.video, "force_rate": 0, "custom_width": 0,
                             "custom_height": 0, "frame_load_cap": 0, "skip_first_frames": 0,
                             "select_every_nth": 1})
    n("2", "RIFE VFI", {"ckpt_name": a.ckpt, "frames": ["1", 0], "clear_cache_after_n_frames": 10,
                        "multiplier": a.mult, "fast_mode": True, "ensemble": True, "scale_factor": 1.0})
    n("3", "VHS_VideoCombine", {"images": ["2", 0], "frame_rate": a.in_fps * a.mult, "loop_count": 0,
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
