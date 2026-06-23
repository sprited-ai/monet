#!/usr/bin/env python3
"""Render one IG caption beat to a transparent 1080x1920 PNG.
Usage: ig_text.py "the text" out.png [y_center] [fontsize]
ffmpeg here has no drawtext (no libfreetype) -> we overlay these PNGs instead.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

text, out = sys.argv[1], sys.argv[2]
text = text.replace("…", "...")  # ellipsis glyph is missing in this TTC weight
yc = int(sys.argv[3]) if len(sys.argv) > 3 else 300
size = int(sys.argv[4]) if len(sys.argv) > 4 else 66

W, H = 1080, 1920
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
# index 8 ~ bold-ish weight in this TTC; fall back gracefully
try:
    font = ImageFont.truetype(FONT, size, index=8)
except Exception:
    font = ImageFont.truetype(FONT, size)

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# word-wrap to max width
maxw = W - 160
words, lines, cur = text.split(" "), [], ""
for w in words:
    t = (cur + " " + w).strip()
    if d.textlength(t, font=font) <= maxw:
        cur = t
    else:
        if cur:
            lines.append(cur)
        cur = w
if cur:
    lines.append(cur)

lh = size + 18
total = lh * len(lines)
y = yc - total // 2
for ln in lines:
    w = d.textlength(ln, font=font)
    x = (W - w) // 2
    # soft drop shadow
    d.text((x + 3, y + 4), ln, font=font, fill=(0, 0, 0, 130))
    # black stroke + white fill for legibility on any bg
    d.text((x, y), ln, font=font, fill=(255, 255, 255, 255),
           stroke_width=6, stroke_fill=(0, 0, 0, 210))
    y += lh

img.save(out)
