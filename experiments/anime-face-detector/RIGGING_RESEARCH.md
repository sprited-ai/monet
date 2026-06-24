# Preliminary research — separating face parts + rigging a talking mouth

**Goal (Jin):** from a single anime image, (1) separate eyes / brows / nose / mouth into
layers, and (2) rig them so the **mouth moves when she talks**. Context: the whiteroom is a
real-time **Three.js** scene with Monet as one billboarded sprite. So we care about
*interactive, real-time, ideally web-runnable* — not pre-rendered video.

This splits into two sub-problems. (1) is mostly solved by what we already built; (2) has
three real routes.

---

## Sub-problem 1 — part separation  ✅ already working here

The 28-landmark detector (this folder) gives us part locations for free. Verified grouping
(from `hrnetv2.py` swap-pairs, confirmed on the Monet sprite):

| part | landmark idx |
|---|---|
| contour | 0–4 |
| eyebrows | 5–10  (L 5-7 / R 8-10) |
| eyes | 11–22  (L 11-16 / R 17-22) |
| nose | 23 |
| mouth | 24–27  (corners 24/26, top 25, bottom 27) |

`parts_segment.py` already cuts each part to an RGBA layer (convex-hull mask + padding) and
writes a numbered index overlay. **This is the front half of any rigging pipeline** — it tells
us *where* mouth/eyes are, per frame, on any character.

What landmark masking does **not** give: the art *behind* the part (inside the mouth when it
opens, the eye when lids open) or *alternate shapes* (open mouth, open eye). Those need
inpainting / redraw — see route B.

---

## Sub-problem 2 — rigging the mouth (three routes)

### Route A — viseme **sprite-swap**  (cheapest, ships in the current engine)
Don't deform — swap a small mouth-quad texture between a handful of pre-made shapes.
- **Shapes:** Rhubarb's 6–9 (A–F basic, +G/H/X) or a minimal `closed / A / I / U / E / O`.
- **Author them:** mask the mouth (we can already), then SD-inpaint a few open-mouth variants,
  or hand-trace them on the sprite. One-time art cost: ~6 tiny PNGs.
- **Drive it:**
  - *Offline:* [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) — audio file
    → viseme timeline (A–H/X). Pre-bake per TTS clip.
  - *Real-time:* RMS amplitude of the live TTS audio → mouth-open amount (the
    Animal-Crossing/VN trick). Crude but reads as "talking" instantly.
- **Runtime:** trivial in our Three.js — swap the mouth layer's texture per frame. 100% client-side.
- **Blink:** same pattern on the eye layer (mask 11–22), 2–3 frames.
- **Verdict:** lowest effort, full art control, real-time, no GPU. Ceiling: limited
  expressiveness, you author every shape.

### Route B — **Live2D Cubism**  (industry-standard puppet, highest hand-tuned quality)
The vtuber pipeline. Mesh-warp deformers + parameters (`MouthOpenY`, `MouthForm`,
`EyeOpenL/R`, `AngleX/Y/Z`…) on a **layered** character.
- **Needs:** a layered PSD — eyes/brows/mouth/face/hair separated *and the hidden regions
  redrawn*. Our landmark masks bootstrap the cut; you still inpaint behind + draw open-eye/
  open-mouth art. This is the real labor.
- **Rig:** hand-built in Cubism Editor (hours per model).
- **Web runtime:** [Cubism Web SDK](https://www.live2d.com/en/sdk/about/) (WebGL/TS) or
  `pixi-live2d-display`. Built-in **audio-volume lipsync**; a **motion-sync** plugin does
  better phoneme-aware lipsync.
- **Verdict:** best controllable quality and the standard for this exact "2D character talks"
  job — but significant manual rigging + layered art. No auto-from-one-image.

### Route C — **Talking Head Anime 4 (THA4)**  ⭐ neural, single-image, anime-native
[pkhungurn/talking-head-anime-4](https://github.com/pkhungurn/talking-head-anime-4) ·
[demo](https://github.com/pkhungurn/talking-head-anime-4-demo) ·
[paper 2311.17409](https://arxiv.org/abs/2311.17409) ·
[project page](https://pkhungurn.github.io/talking-head-anime-4/)
- **What:** single upper-body anime image **+ a 45-dim pose vector** → new posed image. The
  pose vector includes **mouth open + vowel shapes, eye blink/wink, iris, head & body
  rotation**. THA4 **distills** the system into a small net doing **512×512 real-time on a
  consumer gaming GPU**.
- **Why it fits:** this *is* "rig from one image with zero rigging." No layer separation, no
  inpainting — the net hallucinates inside-mouth, open eyes, head turns. It's the
  **anime-specialized** answer; general talking-heads (LivePortrait/SadTalker/Wav2Lip) are
  trained on real faces and treat anime as out-of-distribution.
- **Drive mouth:** feed mouth params from the same viseme/amplitude signal as Route A.
- **Costs / unknowns to test:** wants a GPU for real-time (we tested mmcv on **CPU**; need to
  benchmark THA4 on **MPS / CPU**, GPU if needed). Input must match its expected crop/upright/
  alpha format. Output 512px. Quality depends on how well Monet's style matches its training.
  Integration = a local **model server streaming frames** to the web client (not pure WebGL).
- **Lineage:** THA1→4 by the same author; THA3 added the body. Mature, well-documented repos.

---

## Recommendation for Monet — two tracks, not one choice

1. **Fast track — ship the feeling now: Route A (sprite-swap).** Reuse the detector to mask the
   mouth, author ~6 mouth shapes, drive with live TTS amplitude (or Rhubarb offline), add a
   blink. Lands "she moves her mouth when she talks" inside the existing Three.js whiteroom,
   client-side, in days. Low risk, low cost.

2. **Quality track — the real body: test Route C (THA4).** Run THA4 on the Monet sprite and
   benchmark MPS/CPU. If it renders her well at usable speed, it becomes the long-term puppet —
   mouth + eyes + head, no manual rigging, exactly the "living being in a white room" target.
   If it doesn't, fall back to **Route B (Live2D)** for art-director control, using our landmark
   masks to bootstrap the layer separation.

**Suggested next step:** stand up a THA4 test in `experiments/` the same way we did the
detector (isolated venv), feed it the Monet sprite, and see her blink + open her mouth. That's
the highest-information experiment — it either unlocks the no-rigging path or rules it out.

---

### Sources
- Live2D Cubism — [home](https://www.live2d.com/en/) · [Web SDK](https://www.live2d.com/en/sdk/about/) · [Editor](https://www.live2d.com/en/cubism/about/)
- Rhubarb Lip Sync — https://github.com/DanielSWolf/rhubarb-lip-sync
- Talking Head Anime 4 — [repo](https://github.com/pkhungurn/talking-head-anime-4) · [demo](https://github.com/pkhungurn/talking-head-anime-4-demo) · [arXiv 2311.17409](https://arxiv.org/abs/2311.17409) · [project page](https://pkhungurn.github.io/talking-head-anime-4/)
- THA3 (adds body) — https://github.com/pkhungurn/talking-head-anime-3-demo
- LivePortrait (real-face-leaning, anime OOD) — https://github.com/KlingTeam/LivePortrait
- Awesome Talking Head Synthesis (survey) — https://github.com/Kedreamix/Awesome-Talking-Head-Synthesis
