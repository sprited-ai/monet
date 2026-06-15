"""Monet's first Instagram feed — a curated week of posts.

Uses the winning artwork engine (daubrez-flux) across her art-student range
(landscape, water, still life, animal, people, scene). Square 1:1 for the IG grid.
Output -> out/wholesome/feed/<n>-<subject>.png
"""

from __future__ import annotations

import time
from pathlib import Path

from comfy_client import Comfy
from artwork_gen import flux_lora  # reuse the Daubrez/Flux painterly engine

# Ordered as they'd post over a week. (n, subject, prompt)
FEED = [
    (1, "waterlilies", "a pond covered in water lilies, soft reflections on still water, plein air"),
    (2, "sunflowers", "a still life, a vase of sunflowers on a windowsill in morning light"),
    (3, "cat", "a cat asleep on a sunlit windowsill, cozy and warm"),
    (4, "street-cafe", "a quiet european street cafe in late afternoon light, a few figures at tables"),
    (5, "reader", "a young woman reading a book by a window, soft warm light"),
    (6, "harbor", "a small fishing harbor at dawn, moored boats, hazy light on the water"),
    (7, "garden", "a flower garden in full bloom, dappled sunlight through trees, golden hour"),
    (8, "autumn-path", "an autumn park path strewn with golden leaves, a lone figure walking away"),
]
W, H = 1024, 1024
SEED = 880601


def main():
    c = Comfy()
    out = Path(__file__).parent / "out" / "wholesome" / "feed"
    print(f"server: {c.base}")
    for n, subj, prompt in FEED:
        pid = c.queue(flux_lora(prompt, W, H, SEED + n))
        t0 = time.time()
        imgs = c.images(c.wait(pid, timeout=420))
        if imgs:
            c.download(imgs[0], out / f"{n}-{subj}.png")
            print(f"  {n}. {subj:14} -> ok  ({time.time()-t0:.1f}s)")
        else:
            print(f"  {n}. {subj:14} -> NO IMAGE")


if __name__ == "__main__":
    main()
