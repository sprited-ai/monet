#!/usr/bin/env python3
"""Generate the viseme sprite-sheet template (docs/references/viseme-sheet-template.png).

19 cells (5×4, 256px) — one per viseme in the MAS scheme (hatanasinclaire/mas-lipsync-
prototype), index 0..18 = its `face-viseme-N.png` slots — with a target-shape guide, triggers,
a paint-area disc, and a centre crosshair (the mouth anchor). Paint Monet's 19 mouths into it
(Photoshop), hide the disc, export transparent. The {open,width} guides mirror VISEME_SHAPE in
ui/src/viseme.ts — keep them in sync. See docs/references/viseme-sheet-README.md.

    python scripts/gen-viseme-sheet.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

CELL, COLS, ROWS = 256, 5, 4
W, H = CELL * COLS, CELL * ROWS
SKIN = (238, 210, 180)

# (id, label, triggers, open, width) — index order = MAS face-viseme-N.
VIS = [
    (0, "sil", "무음 / silence", 0.06, 1.0),
    (1, "h", "h", 0.35, 1.0),
    (2, "r", "r (ɹ)", 0.3, 0.85),
    (3, "l", "l / ㄹ", 0.25, 1.0),
    (4, "s z", "s z / ㅅㅆ", 0.16, 1.05),
    (5, "sh", "sh ʃ ʒ / ㅈㅊ", 0.2, 0.8),
    (6, "th", "th (this) ð", 0.2, 1.05),
    (7, "f v", "f v", 0.12, 1.0),
    (8, "t d n", "t d n th / ㄷㄴㅌ", 0.24, 1.0),
    (9, "k g", "k g ng / ㄱㅋ", 0.4, 1.0),
    (10, "p b m", "p b m / ㅁㅂㅍ", 0.0, 1.0),
    (11, "uh", "a (cup) æ ʌ ə / ㅓ", 0.65, 1.1),
    (12, "ah", "ah (car) ɑ / ㅏ", 1.0, 1.0),
    (13, "aw", "aw (saw) ɔ", 0.7, 0.72),
    (14, "eh", "e (bed) ɛ / ㅔ", 0.5, 1.1),
    (15, "er", "er (her) ɝ", 0.35, 0.9),
    (16, "ee", "ee (see) i / ㅣ", 0.3, 1.32),
    (17, "oo", "oo (boot) u w / ㅜ", 0.45, 0.5),
    (18, "oh", "oh (go) o / ㅗ", 0.55, 0.68),
]


def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/AppleGothic.ttf",
              "/System/Library/Fonts/AppleSDGothicNeo.ttc",
              "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    fbig, fsm = font(24), font(15)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for vid, name, trig, op, wd in VIS:
        col, row = vid % COLS, vid // COLS
        cx0, cy0 = col * CELL, row * CELL
        ccx, ccy = cx0 + CELL // 2, cy0 + CELL // 2 + 12
        d.rectangle([cx0, cy0, cx0 + CELL - 1, cy0 + CELL - 1], outline=(150, 150, 150, 140), width=1)
        d.ellipse([ccx - 90, ccy - 90, ccx + 90, ccy + 90], fill=SKIN + (36,))  # paint area (skin)
        nom = CELL * 0.28
        rx, ry = max(8, nom * wd), max(3, nom * op)
        d.ellipse([ccx - rx, ccy - ry, ccx + rx, ccy + ry], outline=(70, 30, 40, 180), width=3)
        d.line([ccx - 9, ccy, ccx + 9, ccy], fill=(120, 120, 120, 150))
        d.line([ccx, ccy - 9, ccx, ccy + 9], fill=(120, 120, 120, 150))
        d.text((cx0 + 7, cy0 + 5), f"{vid}  {name}", font=fbig, fill=(30, 30, 30, 255))
        d.text((cx0 + 7, cy0 + CELL - 24), trig, font=fsm, fill=(60, 60, 60, 230))

    out = os.path.join(os.path.dirname(__file__), "..", "docs", "references", "viseme-sheet-template.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out)
    print("wrote", os.path.normpath(out), im.size)


if __name__ == "__main__":
    main()
