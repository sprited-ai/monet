#!/usr/bin/env python3
"""SCAIL-2 animation-mode runner for Monet — RUNS ON GIN (ComfyUI at 127.0.0.1:8188).

Builds the WanSCAILToVideo API graph (no SAM3 / no mask — single-character animation
mode), submits it, polls /history, and reports the output mp4.

Recipe (all deps already on gin's ComfyUI v0.24.1):
  diffusion : wan2.1_14B_SCAIL_2_fp8_scaled.safetensors   (downloaded into diffusion_models/)
  speed lora: lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors
  text enc  : umt5_xxl_fp8_e4m3fn_scaled.safetensors  (CLIPLoader type=wan)
  clip vis  : clip_vision_h.safetensors
  vae       : wan_2.1_vae.safetensors

WanSCAILToVideo inputs (v0.24.1): positive, negative, vae, width, height, length,
batch_size, pose_strength, pose_start, pose_end, clip_vision_output, reference_image,
pose_video -> (positive, negative, latent). No mask channel in this build.

Usage (on gin):
  python3 run_scail2.py --ref monet_ref_idle1.webp --drive seedance-sample.mp4 \
      --w 640 --h 640 --length 81 --steps 6 --prefix scail2_monet_e1
Both --ref and --drive are filenames already inside ComfyUI/input/.
"""
import argparse, json, time, urllib.request, urllib.error, sys

COMFY = "http://127.0.0.1:8188"

def build_graph(a):
    g = {}
    def node(_id, ctype, inputs):
        g[_id] = {"class_type": ctype, "inputs": inputs}
    # model branch
    node("1", "UNETLoader", {"unet_name": a.unet, "weight_dtype": "default"})
    node("2", "LoraLoaderModelOnly", {"model": ["1", 0], "lora_name": a.lora, "strength_model": a.lora_strength})
    node("3", "ModelSamplingSD3", {"model": ["2", 0], "shift": a.shift})
    # text branch
    node("4", "CLIPLoader", {"clip_name": a.umt5, "type": "wan"})
    node("5", "CLIPTextEncode", {"clip": ["4", 0], "text": a.positive})
    node("6", "CLIPTextEncode", {"clip": ["4", 0], "text": a.negative})
    # reference image + clip vision
    node("7", "LoadImage", {"image": a.ref})
    node("8", "CLIPVisionLoader", {"clip_name": a.clip_vision})
    node("9", "CLIPVisionEncode", {"clip_vision": ["8", 0], "image": ["7", 0], "crop": "center"})
    # vae + driving (pose) video frames
    node("10", "VAELoader", {"vae_name": a.vae})
    node("11", "VHS_LoadVideo", {"video": a.drive, "force_rate": a.fps, "custom_width": a.w,
                                 "custom_height": a.h, "frame_load_cap": a.length,
                                 "skip_first_frames": a.skip, "select_every_nth": 1})
    # SCAIL core
    node("12", "WanSCAILToVideo", {
        "positive": ["5", 0], "negative": ["6", 0], "vae": ["10", 0],
        "width": a.w, "height": a.h, "length": a.length, "batch_size": 1,
        "pose_strength": a.pose_strength, "pose_start": 0.0, "pose_end": 1.0,
        "clip_vision_output": ["9", 0], "reference_image": ["7", 0], "pose_video": ["11", 0]})
    # sample / decode / save
    node("13", "KSampler", {"model": ["3", 0], "positive": ["12", 0], "negative": ["12", 1],
                            "latent_image": ["12", 2], "seed": a.seed, "steps": a.steps,
                            "cfg": a.cfg, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0})
    node("14", "VAEDecode", {"samples": ["13", 0], "vae": ["10", 0]})
    node("15", "VHS_VideoCombine", {"images": ["14", 0], "frame_rate": a.fps, "loop_count": 0,
                                    "filename_prefix": a.prefix, "format": "video/h264-mp4",
                                    "pix_fmt": "yuv420p", "crf": 18, "save_output": True,
                                    "pingpong": False, "save_metadata": True})
    return g

def post(path, payload):
    req = urllib.request.Request(COMFY + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print("[HTTP %d] %s" % (e.code, body), flush=True)
        raise

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ref", required=True); p.add_argument("--drive", required=True)
    p.add_argument("--w", type=int, default=640); p.add_argument("--h", type=int, default=640)
    p.add_argument("--length", type=int, default=81); p.add_argument("--skip", type=int, default=0)
    p.add_argument("--fps", type=int, default=16); p.add_argument("--steps", type=int, default=6)
    p.add_argument("--cfg", type=float, default=1.0); p.add_argument("--shift", type=float, default=8.0)
    p.add_argument("--pose_strength", type=float, default=1.0)
    p.add_argument("--lora_strength", type=float, default=1.0); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--prefix", default="scail2_monet")
    p.add_argument("--unet", default="wan2.1_14B_SCAIL_2_fp8_scaled.safetensors")
    p.add_argument("--lora", default="lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors")
    p.add_argument("--umt5", default="umt5_xxl_fp8_e4m3fn_scaled.safetensors")
    p.add_argument("--clip_vision", default="clip_vision_h.safetensors")
    p.add_argument("--vae", default="wan_2.1_vae.safetensors")
    p.add_argument("--positive", default="a cute chibi anime girl, smooth clean animation, soft lighting, high quality")
    p.add_argument("--negative", default="blurry, low quality, distorted, deformed, extra limbs, jpeg artifacts, watermark")
    a = p.parse_args()

    g = build_graph(a)
    print(f"[submit] {a.ref} <- {a.drive}  {a.w}x{a.h} len={a.length} steps={a.steps} seed={a.seed}", flush=True)
    r = post("/prompt", {"prompt": g})
    pid = r["prompt_id"]
    print(f"[queued] prompt_id={pid}", flush=True)
    t0 = time.time()
    while True:
        time.sleep(4)
        try:
            h = json.load(urllib.request.urlopen(f"{COMFY}/history/{pid}", timeout=30))
        except Exception as e:
            print(f"[poll] {e}", flush=True); continue
        if pid in h:
            st = h[pid].get("status", {})
            print(f"[done] {time.time()-t0:.0f}s status={st.get('status_str')}", flush=True)
            outs = h[pid].get("outputs", {})
            for nid, o in outs.items():
                for vids in o.get("gifs", []) + o.get("videos", []):
                    print(f"[output] {vids.get('filename')}  (subfolder={vids.get('subfolder','')})", flush=True)
            if st.get("status_str") == "error":
                for m in st.get("messages", []):
                    print("[err]", m, flush=True)
            return
        if time.time() - t0 > 1800:
            print("[timeout] >30min", flush=True); return

if __name__ == "__main__":
    main()
