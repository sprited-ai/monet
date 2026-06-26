#!/usr/bin/env python3
"""Monet video-generation pipeline — animate a still image into a video via Seedance (ByteDance) on fal.ai.

This is the GENERATION engine (image -> new motion clip). It pairs with the COMPOSITION
engine (scripts/ig-videos.sh) which lays text/bg over clips. Seedance output is a normal
RGB mp4 of the whole frame (rain, street, character all move), so it's directly postable.

Best place for the API (see docs/014-seedance-pipeline.md):
  fal.ai — official ByteDance Seedance models, clean queue API, returns a hosted mp4 URL.
  Models:
    seedance-1.0-pro  : fal-ai/bytedance/seedance/v1/pro/image-to-video   (~$0.62 /1080p 5s)
    seedance-2.0      : fal-ai/bytedance/seedance-2.0/image-to-video       (generalist, pricier)
    seedance-2.0-fast : fal-ai/bytedance/seedance-2.0/fast/image-to-video  (cheaper, ~$0.24/s 720p)

Auth: set FAL_KEY in your env (get it at https://fal.ai/dashboard/keys — YOU enter your own key;
never paste it into chat). The script never logs the key.

Usage:
  FAL_KEY=... python3 scripts/seedance.py \
      --image references/inspirations/concept-34-umbrella-rain.jpg \
      --prompt "gentle rain, raindrops slide off the umbrella, neon reflections shimmer, hair sways, she blinks and looks up" \
      --model seedance-1.0-pro --resolution 1080p --duration 5 \
      --out ig/gen/concept-34-umbrella-rain.mp4
"""
import argparse, base64, json, mimetypes, os, sys, time, urllib.request, urllib.error

MODELS = {
    "seedance-1.0-pro":  "fal-ai/bytedance/seedance/v1/pro/image-to-video",
    "seedance-2.0":      "bytedance/seedance-2.0/image-to-video",
    "seedance-2.0-fast": "bytedance/seedance-2.0/fast/image-to-video",
}


def _req(url, key, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Key {key}")
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"fal HTTP {e.code}: {e.read().decode()[:500]}")


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--model", default="seedance-1.0-pro", choices=MODELS)
    ap.add_argument("--resolution", default="1080p")
    ap.add_argument("--duration", type=int, default=5)
    ap.add_argument("--out", required=True)
    ap.add_argument("--audio", action="store_true",
                    help="generate synchronized audio (2.0 only; default off — its audio filter "
                         "false-positives and we add our own music for IG)")
    a = ap.parse_args()

    key = os.environ.get("FAL_KEY")
    if not key:
        sys.exit("FAL_KEY not set. Get a key at https://fal.ai/dashboard/keys and `export FAL_KEY=...` "
                 "(enter it yourself; do not paste it into chat).")
    if not os.path.exists(a.image):
        sys.exit(f"image not found: {a.image}")

    model = MODELS[a.model]
    payload = {
        "image_url": data_uri(a.image),
        "prompt": a.prompt,
        "resolution": a.resolution,
        "duration": str(a.duration),
    }
    if a.model.startswith("seedance-2"):
        payload["generate_audio"] = a.audio
    print(f">> submit {a.model}  ({a.resolution}, {a.duration}s)  <- {a.image}", flush=True)
    sub = _req(f"https://queue.fal.run/{model}", key, "POST", payload)
    status_url, response_url = sub["status_url"], sub["response_url"]

    while True:
        st = _req(status_url, key)
        s = st.get("status")
        print(f"   .. {s}", flush=True)
        if s == "COMPLETED":
            break
        if s in ("FAILED", "ERROR"):
            sys.exit(f"generation failed: {json.dumps(st)[:500]}")
        time.sleep(5)

    res = _req(response_url, key)
    url = res.get("video", {}).get("url") or (res.get("videos") or [{}])[0].get("url")
    if not url:
        sys.exit(f"no video url in result: {json.dumps(res)[:500]}")

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    print(f">> download -> {a.out}", flush=True)
    urllib.request.urlretrieve(url, a.out)
    print(f"== done: {a.out}  (seed={res.get('seed')})")


if __name__ == "__main__":
    main()
