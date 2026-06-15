"""Local content filter — flag "private" images by renaming them to `*.private.*`.

Runs fully locally (no external API) using the Falconsai/nsfw_image_detection
ViT classifier on the torch already installed here. Images scoring above the
threshold are renamed in place with a `.private.` infix (e.g. study.png -> study.private.png),
which the repo's .gitignore excludes from git.

Terminology: "wholesome" = safe-for-anywhere, "private" = keep-local-only.

Usage:
    python3 private_filter.py [dir] [--threshold 0.7] [--dry-run]

Default dir is ./out. Already-flagged files (`.private.` in name) are skipped.
First run downloads the ~340MB model.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

EXTS = {".png", ".jpg", ".jpeg", ".webp"}
MODEL = "Falconsai/nsfw_image_detection"  # model's own label is "nsfw"; our infix is ".private"


def flagged_name(p: Path) -> Path:
    return p.with_name(f"{p.stem}.private{p.suffix}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", nargs="?", default=str(Path(__file__).parent / "out"))
    ap.add_argument("--threshold", type=float, default=0.7)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = Path(args.dir)
    images = [
        p for p in root.rglob("*")
        if p.suffix.lower() in EXTS and ".private." not in p.name
    ]
    if not images:
        print(f"no unflagged images under {root}")
        return

    from transformers import pipeline  # imported late so --help is instant
    import torch

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"loading {MODEL} on {device} … ({len(images)} images, threshold {args.threshold})")
    clf = pipeline("image-classification", model=MODEL, device=device)

    flagged = 0
    for p in sorted(images):
        scores = {d["label"].lower(): d["score"] for d in clf(str(p))}
        score = scores.get("nsfw", 0.0)
        if score >= args.threshold:
            dest = flagged_name(p)
            print(f"  PRIVATE {score:.2f}  {p.relative_to(root)}  ->  {dest.name}")
            if not args.dry_run:
                p.rename(dest)
            flagged += 1
        else:
            print(f"  ok      {score:.2f}  {p.relative_to(root)}")

    verb = "would flag" if args.dry_run else "flagged"
    print(f"\n{verb} {flagged}/{len(images)} as private.")


if __name__ == "__main__":
    sys.exit(main())
