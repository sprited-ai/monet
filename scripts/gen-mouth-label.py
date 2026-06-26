#!/usr/bin/env python3
"""Label the viseme atlas: overlay each cell's id + meaning onto contents/monet/mouth-atlas.png
→ contents/monet/mouth-atlas.label.png. A legend for painting (which cell is which viseme).
Thin cell grid + labels only (no skin disc). Regenerate after re-baking the atlas.

    python scripts/gen-viseme-label.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

CELL, COLS, ROWS = 256, 5, 4
# (id, key, meaning) — matches VISEME_SHAPE/VISEME_LABEL order in ui/src/viseme.ts.
VIS = [
    (0, "sil", "silence / 무음"),
    (1, "h", "h"),
    (2, "r", "r (red)"),
    (3, "l", "l / ㄹ"),
    (4, "s z", "s z / ㅅㅆ"),
    (5, "sh", "sh ʃ / ㅈㅊ"),
    (6, "th", "th (this)"),
    (7, "f v", "f v"),
    (8, "t d n", "t d n th / ㄷㄴㅌ"),
    (9, "k g", "k g ng / ㄱㅋ"),
    (10, "p b m", "p b m / ㅁㅂㅍ"),
    (11, "uh", "a (cup) / ㅓ"),
    (12, "ah", "ah (car) / ㅏ"),
    (13, "aw", "aw (saw)"),
    (14, "eh", "e (bed) / ㅔ"),
    (15, "er", "er (her)"),
    (16, "ee", "ee (see) / ㅣ"),
    (17, "oo", "oo (boot) / ㅜ"),
    (18, "oh", "oh (go) / ㅗ"),
]


def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/AppleGothic.ttf",
              "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    root = os.path.join(os.path.dirname(__file__), "..")
    atlas = os.path.join(root, "contents", "monet", "mouth-atlas.png")
    im = Image.open(atlas).convert("RGBA")
    d = ImageDraw.Draw(im)
    fbig, fsm = font(24), font(15)
    for vid, key, meaning in VIS:
        cx0, cy0 = (vid % COLS) * CELL, (vid // COLS) * CELL
        d.rectangle([cx0, cy0, cx0 + CELL - 1, cy0 + CELL - 1], outline=(120, 120, 120, 120), width=1)
        # label backdrops for readability over any mouth color
        d.rectangle([cx0, cy0, cx0 + CELL, cy0 + 30], fill=(255, 255, 255, 180))
        d.rectangle([cx0, cy0 + CELL - 26, cx0 + CELL, cy0 + CELL], fill=(255, 255, 255, 180))
        d.text((cx0 + 6, cy0 + 4), f"{vid}  {key}", font=fbig, fill=(20, 20, 20, 255))
        d.text((cx0 + 6, cy0 + CELL - 22), meaning, font=fsm, fill=(50, 50, 50, 255))
    out = os.path.join(root, "contents", "monet", "mouth-atlas.label.png")
    im.save(out)
    print("wrote", os.path.normpath(out), im.size)


if __name__ == "__main__":
    main()
