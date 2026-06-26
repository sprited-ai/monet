#!/usr/bin/env python3
"""Jaw lip-sync atlas TEMPLATE — the small anime-style set (Silly Crocodile approach): a short
jaw-open ladder, not per-phoneme visemes. Jin paints Monet's mouths into the TOP ROW, then
exports as contents/monet/mouth-atlas.png (the sampler reads a 5×4 / 128px grid; JAW uses
cells 0..3). → docs/references/jaw-atlas-template.webp.

    python scripts/gen-jaw-template.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

# 128px cell = Monet's mouth at its native pixel scale in the regular reference (monet-idle-
# quarter.png 1184²; her closed smile is ~100–125px wide). 5×4 keeps the sampler grid; jaw
# uses the TOP ROW. Display size is set separately by uSpriteScale, not the cell px.
CELL, COLS, ROWS = 128, 5, 4
W, H = CELL * COLS, CELL * ROWS
ANCHOR_V = 0.40  # the shader pins the sprite's UPPER LIP at this cell-row → put the lip here

# (id, name, sub, openness 0..1, round?) — the jaw ladder, amplitude-driven (4 shapes). No 'o':
# rounding needs to know the SOUND is round, which amplitude alone can't tell.
JAW = [
    (0, "closed", "rest / 입 다묾", 0.0, False),
    (1, "30%", "살짝 / slight", 0.32, False),
    (2, "60%", "중간 / mid", 0.62, False),
    (3, "100%", "크게 / wide", 1.0, False),
]


def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/AppleGothic.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    fbig, fsm = font(15), font(10)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for vid, name, sub, op, rnd in JAW:
        cx0, cy0 = (vid % COLS) * CELL, (vid // COLS) * CELL
        ccx = cx0 + CELL // 2
        ly = cy0 + int(CELL * ANCHOR_V)  # upper-lip anchor row
        d.rectangle([cx0, cy0, cx0 + CELL - 1, cy0 + CELL - 1], outline=(150, 150, 150, 150), width=1)
        # openness guide: mouth opens DOWN from the upper-lip line
        rx = CELL * (0.16 if rnd else 0.30)
        ry = max(2, CELL * (0.22 if rnd else 0.30) * (op if op > 0 else 0.02))
        d.ellipse([ccx - rx, ly, ccx + rx, ly + 2 * ry], outline=(70, 30, 40, 150), width=2)
        # upper-lip anchor crosshair
        d.line([ccx - 10, ly, ccx + 10, ly], fill=(200, 60, 60, 200), width=1)
        d.line([ccx, ly - 7, ccx, ly + 7], fill=(200, 60, 60, 200), width=1)
        d.text((cx0 + 7, cy0 + 5), f"{vid}  {name}", font=fbig, fill=(25, 25, 25, 255))
        d.text((cx0 + 7, cy0 + CELL - 22), sub, font=fsm, fill=(60, 60, 60, 230))

    # notes in the empty area
    note = font(14)
    nx, ny = 10, CELL + 14
    for i, line in enumerate([
        "JAW lip-sync atlas — paint these 4 cells (0–3) only. Amplitude opens the jaw.",
        "• Upper lip ON the red crosshair; the mouth opens DOWNWARD from it.",
        "• Keep all at the SAME width/scale, lit the same (they swap frame-to-frame).",
        "• 3/4 VIEW: draw the interior/tongue receding to one side, to match her",
        "  quarter-view face (not a flat front-on mouth).",
        "• Transparent background (composites over her skin).",
        "• Export as contents/monet/mouth-atlas.png.",
    ]):
        d.text((nx, ny + i * 26), line, font=note, fill=(40, 40, 40, 255))

    out = os.path.join(os.path.dirname(__file__), "..", "docs", "references", "jaw-atlas-template.webp")
    im.save(out)
    print("wrote", os.path.normpath(out), im.size)


if __name__ == "__main__":
    main()
