# /// script
# requires-python = ">=3.9"
# dependencies = ["pillow>=10"]
# ///
"""Convert every PNG under a directory tree to WebP.

Usage:
    uv run scripts/compress_pngs.py ./references                # lossy quality 95 (default)
    uv run scripts/compress_pngs.py ./references -q 90          # tune the quality
    uv run scripts/compress_pngs.py ./references --lossless     # pixel-identical, larger
    uv run scripts/compress_pngs.py ./references --delete       # remove the .png after converting

Each `foo.png` becomes `foo.webp` next to it. The default is lossy WebP at
quality 95 — visually indistinguishable from the source but much smaller than
lossless. Existing `.webp` files are skipped unless --force is given.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image


def convert(
    png: Path, *, quality: int, lossless: bool, force: bool, delete: bool
) -> tuple[int, int] | None:
    webp = png.with_suffix(".webp")
    if webp.exists() and not force:
        print(f"  skip  {png}  (webp exists)")
        return None

    before = png.stat().st_size
    with Image.open(png) as im:
        # method=4 is libwebp's default — good speed/size balance. lossless keeps
        # every pixel exact; otherwise quality drives the lossy compression
        # (95 ≈ visually lossless).
        im.save(webp, "WEBP", lossless=lossless, quality=quality, method=4)
    after = webp.stat().st_size

    pct = (1 - after / before) * 100 if before else 0
    print(f"  ok    {png}  {before:>9,} -> {after:>9,}  ({pct:+.1f}%)", flush=True)

    if delete:
        png.unlink()
    return before, after


def main() -> int:
    ap = argparse.ArgumentParser(description="Convert PNGs to WebP (lossy q95 by default).")
    ap.add_argument("root", type=Path, help="directory to scan recursively")
    ap.add_argument(
        "-q", "--quality", type=int, default=95,
        help="lossy WebP quality 0-100 (default: 95); ignored with --lossless",
    )
    ap.add_argument("--lossless", action="store_true", help="pixel-identical WebP (larger)")
    ap.add_argument("--force", action="store_true", help="overwrite existing .webp files")
    ap.add_argument("--delete", action="store_true", help="delete each .png after converting")
    args = ap.parse_args()

    if not args.root.is_dir():
        print(f"error: {args.root} is not a directory", file=sys.stderr)
        return 2

    pngs = sorted(args.root.rglob("*.png"))
    if not pngs:
        print(f"no PNGs found under {args.root}")
        return 0

    mode = "lossless" if args.lossless else f"lossy q{args.quality}"
    print(f"converting {len(pngs)} PNG(s) under {args.root}  ({mode})", flush=True)
    total_before = total_after = converted = 0
    for png in pngs:
        result = convert(
            png, quality=args.quality, lossless=args.lossless,
            force=args.force, delete=args.delete,
        )
        if result:
            b, a = result
            total_before += b
            total_after += a
            converted += 1

    if converted:
        saved = total_before - total_after
        pct = saved / total_before * 100 if total_before else 0
        print(
            f"\ndone: {converted} converted, "
            f"{total_before:,} -> {total_after:,} bytes "
            f"({saved:,} saved, {pct:.1f}%)"
        )
    else:
        print("\ndone: nothing converted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
