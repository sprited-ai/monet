#!/usr/bin/env python3
"""Measure contents/ assets into contents/index.json + contents/framings.json.

Stills (png/webp) carry alpha, so we measure their normalized `origin`
(anchor = bbox bottom-center) and `bbox` directly. Animations (webm) are opaque
(black bg) and downscaled — we DON'T do any per-frame CV on them; their layout is
determined by the framing postfix (`-large`/`-wide`/regular) and they inherit that
framing's origin. So webm entries store only framing + fps + frames.

`framings.json` holds the per-framing origin (taken from a representative still).
Hand-authored fields (loop, name, kind, tags) live in per-asset sidecars.

Run locally (repo .venv: PIL + ffprobe on PATH):
    .venv/bin/python scripts/measure-contents.py
"""

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CONTENTS = ROOT / "contents"
PREFIX = "monet"
ANIM_EXT = {".mp4"}
STILL_EXT = {".png", ".webp", ".jpg", ".jpeg"}


def framing_of(name: str) -> str:
    if "-wide" in name:
        return "wide"
    if "-large" in name:
        return "large"
    return "regular"


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets",
         "-show_entries", "stream=r_frame_rate,nb_read_packets", "-of", "json", str(path)],
        capture_output=True, text=True,
    ).stdout
    s = json.loads(out)["streams"][0]
    num, den = (s["r_frame_rate"].split("/") + ["1"])[:2]
    fps = round(int(num) / int(den), 3) if int(den) else 0
    return {"fps": fps, "frames": int(s.get("nb_read_packets", 0))}


def still_origin(path: Path):
    """(origin[cx,bottom], bbox[x,y,w,h] normalized, frame[W,H]) or (None,None,(W,H))."""
    im = Image.open(path).convert("RGBA")
    W, H = im.size
    box = im.getchannel("A").getbbox()
    if not box:
        return None, None, (W, H)
    l, u, r, lo = box
    origin = [round((l + r) / 2 / W, 4), round(lo / H, 4)]
    bbox = [round(l / W, 4), round(u / H, 4), round((r - l) / W, 4), round((lo - u) / H, 4)]
    return origin, bbox, (W, H)


def main():
    base = CONTENTS / PREFIX
    files = sorted(p for p in base.iterdir()
                   if p.is_file() and p.suffix.lower() in (ANIM_EXT | STILL_EXT)
                   and ".thumbnail." not in p.name)  # skip colocated poster thumbnails
    items, framings = {}, {}
    for p in files:
        name = p.stem
        framing = framing_of(name)
        entry = {"key": p.relative_to(CONTENTS).as_posix(), "name": name, "framing": framing}
        try:
            if p.suffix.lower() in ANIM_EXT:
                entry.update(ffprobe(p))  # framing-only layout; no CV on opaque frames
            else:
                origin, bbox, dims = still_origin(p)
                entry.update({"origin": origin, "bbox": bbox})
                # First still of a framing defines its frame size (for the safe bound).
                if framing not in framings:
                    framings[framing] = {"origin": origin, "frame": list(dims)}
            items[name] = entry
            print(f"{name:32} {framing:8} {entry.get('origin', '(inherits framing)')}")
        except Exception as ex:
            print(f"ERR {p.name}: {type(ex).__name__}: {ex}", file=sys.stderr)

    (CONTENTS / "index.json").write_text(json.dumps({"items": items}, indent=2))
    (CONTENTS / "framings.json").write_text(
        json.dumps({"base": "regular", "framings": framings}, indent=2))
    print(f"\nwrote contents/index.json ({len(items)} items) "
          f"+ contents/framings.json ({sorted(framings)})")


if __name__ == "__main__":
    main()
