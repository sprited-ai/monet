# Backlog

Single source of truth for outstanding work. Add new TODOs here; cross off to `## Done` when
finished. See `CLAUDE.md` for the discipline.

## Active

- [ ] Wire the generators to read `models.yaml` instead of hardcoding checkpoints.
- [ ] Finish the WAN 2.2 i2v sample clip from a chosen still.
- [ ] IPAdapter FaceID / InstantID to lock ONE consistent face across photoreal photos.
- [ ] Pose/scene sweep on the chosen avatar model (standing, sitting, looking back, waving).
- [ ] Constrain the rainbow-bow bleed (keep rainbow on the bow, off the hair tips).
- [ ] Find/install an SD1.5 base so the Claude-Monet-style LoRA (`monet_v2`) is usable.

## Blocked / needs Jin

- [ ] `PERSONA.png` — **Jin is working on it**; hands off.

## Done

- [x] ComfyUI access via Cloudflare Access service token (+ Bot-Fight UA fix); reusable client.
- [x] PERSONA.md authored, then revised: adult 21+, art-student practicing all subjects
      (people included), childhood = separate track, DNA = `alternative-concept-1.png`.
- [x] Removed MIT `LICENSE`; README/CHANGELOG updated to closed-source.
- [x] Organized childhood assets into `references/design/childhood/` (moved, not deleted).
- [x] Avatar sweep (8 S-tier × 3 seeds) regenerated as adults + contact sheet.
- [x] Concept posts (4) + captions (`posts.md`) + IG preview HTML.
- [x] Diverse style/subject exploration (12) + contact sheet.
- [x] Adult academic figure-study track (4) — finding: anime checkpoints sexualize figures,
      need fine-art models.
- [x] Civitai survey of painterly/landscape models.
- [x] Audience-likes simulation (8 personas) + leaderboard (`out/wholesome/explore/likes-results.md`).
- [x] Reaction-ladder simulation (skip/like/comment/repost) (`out/wholesome/explore/reactions-results.md`).
- [x] Full-body persona sweep across S-tier models (`out/wholesome/persona/`).
- [x] Artwork track: 3 painterly engines × 5 subjects; **daubrez-flux** chosen as feed style.
- [x] Assembled first-week feed (8 daubrez-flux posts) + captions (`feed/posts.md`) + profile-grid preview (`feed/feed-preview.html`).
- [x] Photoreal `photos/` track — 4 real-human variations of PERSONA.png via Kontext (filter-clean).
- [x] Symlink aliases for all awkward model names; `models.yaml` fully aliased.
- [x] Installed painterly LoRAs on gin: Daubrez-Flux, Impasto-NoobAI, Claude-Monet (SD1.5), ClassipeintXL.
- [x] `models.yaml` — editable source of truth for models per track (avatar/artwork/i2v/kontext).
- [x] Fixed `noobai-vpred` via `ModelSamplingDiscrete (v_prediction, zsnr)` (used in artwork engine).
- [x] Instagram profile copy drafted (`instagram-profile.md`).
- [x] Bucketed all output into `wholesome/` and `private/`; repointed generators.
- [x] Git-ignore private content: `private/`, `private-*`, `*.private.*` (root `.gitignore`).
- [x] Local content filter (`private_filter.py`, Falconsai ViT) — flags → `*.private.*`.
      Caught a real leak: `pvc-figure__880601` had slipped into the wholesome avatar track.
- [x] `CLAUDE.md` backlog discipline + this `BACKLOG.md`.
