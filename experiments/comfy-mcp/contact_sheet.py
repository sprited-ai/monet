"""Build a labeled contact sheet from a directory of `<row>__<col>.png` renders.

Rows group by the part before `__`, columns by the part after. Each cell is
labeled, with a title band on top — so a model/pose sweep reads at a glance.

Usage: python3 contact_sheet.py <dir> <out.jpg> "Title"
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

THUMB_W = 280
PAD = 8
LABEL_H = 22
TITLE_H = 40
ROWHDR_W = 130
BG = (245, 245, 245)
INK = (40, 40, 40)


def _font(size: int):
    for p in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build(src: Path, out: Path, title: str) -> None:
    files = sorted(src.glob("*.png"))
    if not files:
        raise SystemExit(f"no PNGs in {src}")

    rows: dict[str, dict[str, Path]] = {}
    cols: list[str] = []
    for f in files:
        stem = f.stem
        row, _, col = stem.partition("__")
        col = col or "—"
        rows.setdefault(row, {})[col] = f
        if col not in cols:
            cols.append(col)
    cols.sort()
    row_keys = list(rows.keys())

    # Cell height from first image aspect.
    sample = Image.open(files[0])
    thumb_h = round(THUMB_W * sample.height / sample.width)
    cell_w, cell_h = THUMB_W + PAD, thumb_h + LABEL_H + PAD

    W = ROWHDR_W + len(cols) * cell_w + PAD
    H = TITLE_H + len(row_keys) * cell_h + PAD
    sheet = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(sheet)
    tf, lf, rf = _font(22), _font(13), _font(15)

    draw.text((PAD, 10), title, fill=INK, font=tf)
    # Column headers.
    for ci, col in enumerate(cols):
        x = ROWHDR_W + ci * cell_w
        draw.text((x + 4, TITLE_H - 16), f"seed/{col}" if col.isdigit() else col, fill=(120, 120, 120), font=lf)

    for ri, rk in enumerate(row_keys):
        y = TITLE_H + ri * cell_h
        draw.text((PAD, y + thumb_h // 2), rk, fill=INK, font=rf)
        for ci, col in enumerate(cols):
            f = rows[rk].get(col)
            if not f:
                continue
            x = ROWHDR_W + ci * cell_w
            im = Image.open(f).convert("RGB").resize((THUMB_W, thumb_h))
            sheet.paste(im, (x, y))
            draw.text((x + 2, y + thumb_h + 3), f.stem, fill=(110, 110, 110), font=lf)

    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=90)
    print(f"  contact sheet: {out}  ({len(files)} imgs, {len(row_keys)}x{len(cols)})")


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else "contact sheet")
