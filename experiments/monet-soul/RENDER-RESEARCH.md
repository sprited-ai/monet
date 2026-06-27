# 3D Monet → her painterly look — render research (decision-grade)

A 5-agent research sweep (2026-06-26) on rendering a hand-made 3D Monet in her painterly Seedance
style — temporal-consistent, for a *living* desktop being. Four independent briefs **converged** on
the same architecture (= consensus, not a guess). This is the synthesis; raw briefs in the workflow
transcript. Pairs with `MOAT.md` (why the depth-driven body is ours) and the JOURNAL "Strategic turn".

## The one idea
**Diffusion is never in the real-time loop — it is the OFFLINE look-baker.** The living body =
a deterministic shader / 3D-native render + small real-time deltas. `depth + normal` bridges both.

**Split by MOTION TYPE, not quality:**
- **Offline bake = appearance + big motions** (retargeted Seedance motions, hero animations). Full
  diffusion fidelity, baked once → stored as clips. (= the *decode* done ahead of time.)
- **Real-time = small geometric deltas only** (gaze/cursor, blink, breath, micro head-turn). Small
  deltas on an *already-painterly-baked* base need ~no restyle. (= *edit the rig* live; barely touch
  decode.)

So "alive + painterly + local + real-time" IS achievable now — by moving small parts of a pre-styled
asset, not restyling every frame. This is the `encode → edit-rig → decode` model with the **decode
split** (offline diffusion for appearance/big-motion, real-time shader for small live deltas).

**Why real-time is mathematically REQUIRED (Jin's argument), not optional:** pre-baked-only is a
*combinatorial explosion* — `N_motion × N_gaze × N_light × N_blend × N_micro`. The continuous
dimensions (gaze = wherever the cursor is; relight = whatever color the screen is; blends; micro-
variation) have infinite combinations — you literally cannot pre-bake a continuum. So the continuous
axes MUST be real-time deltas. This is precisely the argument for a 3D base over pure sprites: sprites
= pre-baked-only = the explosion; 3D base + real-time delta = continuous axes done procedurally, zero
explosion. Relight is the cleanest example — pre-baking every lighting explodes; one normal-driven
shader covers infinite lighting. Our depth/normal make the continuous deltas cheap + deterministic
(no diffusion in the loop). **This elevates the real-time-base experiment** (MatCap/shader carrying
her look) to equal priority with the diffusion-fidelity one — it's the part that kills the explosion.

## Our asymmetric advantage
Others *estimate* depth/normal; we *render it ground-truth* from the hand-mesh and already hold
depth/normal sidecars for the Seedance clips. This removes the #1 failure of video restyle (bad
optical-flow correspondence) — consistency comes from geometry. Tilts this from a research gamble to
engineering in our favor.

## Recommended pipeline
- **Stage 0 — identity (1×):** 20–30 *varied* curated frames (variety collapse is the real risk),
  train a LoRA. **Separate identity from style** (B-LoRA / InstantStyle / IP-Adapter) so 3D reposing
  doesn't drift identity. (Closest published target: multi-token DreamBooth+LoRA, arXiv 2510.09475.)
- **Stage 1 — motion:** hand-3D Monet mesh + SAM3D-extracted rig, retargeted (rig works per memory;
  `smooth_rig.py` de-jitters). **Do NOT reconstruct a riggable avatar from the clips** (not
  multiview-consistent → blurry mean; identity drift). Hand-mesh is the geometric truth.
- **Stage 2 — offline library bake (heavy GPU here):** rigged-mesh render → export ground-truth
  depth/normal/lineart/id G-buffer → ControlNet(depth+normal+lineart) + Monet LoRA + temporal.
  Tools: **Diffutoon** (runs today; biases flat-cel, fight it for her soft/watercolor look);
  **Generative Rendering** (CVPR'24 — canonical-UV correspondence in attention, almost exactly our
  setup; no production code, expect re-impl); temporal via **TokenFlow** / **warped-noise prior**
  (ICLR'24) or **diffusion keyframes → EbSynth**.
- **Stage 3 — real-time (gaze/cursor):** in-engine render of the styled asset (WebGL/WebGPU; MatCap
  authored from her frames + normal-driven painterly shader; or animatable Gaussian). Live delta =
  eyes/head/breath. If the shader can't reach her look → a **distilled neural texture** (tiny
  pix2pix: {depth,normal,uv,id}→painterly RGB, supervised by rig↔frame pairs).
- **Bridge:** depth+normal conditions Stage 2 *and* validates Stage 3 matches the baked look.

## The "3D→painterly is ugly" step — main bet + 2 fallbacks
- **Main:** ControlNet(depth+normal) + identity/style-separated LoRA, EbSynth to finish flicker. Our
  G-buffer is ground-truth → kills bad-flow failures; B-LoRA/InstantStyle is the lever between
  "generic anime girl" and "Monet".
- **Fallback 1 — EbSynth (texture synthesis, not AI):** diffuse a few keyframes in her style →
  propagate via optical flow. Zero hallucination, zero flicker, brushstrokes preserved (used in
  Apollo 10½, Wednesday). Best fidelity/least flicker for *library clips*; weak on big new content.
- **Fallback 2 — MatCap + anisotropic Kuwahara (the real-time base):** paint a lit-sphere from her
  frames, map by view-space normal = deterministic, flicker-free, "painterly not flat-cel"; season
  with anisotropic Kuwahara for brush texture. This is how the real-time half carries *any* of her
  look. Note: cel shading fundamentally can't do her brushy color-bleed — *exact* Seedance = offline.

## Cheapest de-risk experiment (days, no pivot, NO mesh needed)
Riskiest unproven assumption: *can depth/normal-conditioned diffusion reproduce HER specific painterly
look (not generic anime / blurry mean)?* — testable using existing clips + their sidecars, where the
**original clip pixels are the ground truth**:
1. Pick 1 existing Seedance clip (with its depth+normal sidecar).
2. Train Monet identity/style LoRA on *held-out* frames (not that clip).
3. Pass that clip's depth+normal through ControlNet+LoRA → re-synthesize.
4. Compare to the real original clip.

**Success:** (a) blind A/B — Jin can't tell re-render from original; (b) low temporal warp-error, no
flicker; (c) recognizably *her*, not "an anime girl". ~2–4 days on gin GPU. No mesh/retarget/engine
needed — it tests the whole "depth/normal → her painterly look, consistent" proposition and measures
*fidelity*, not vibes. Side experiment (1 day): MatCap-from-her-frames + Kuwahara → WebGL → does it
read as "painterly Monet" vs "generic toon" (tests the real-time half).

## Honest verdict
- **Offline-growing library: SOLVABLE today** (Diffutoon/TokenFlow/EbSynth). Already an upgrade over
  Seedance — rig-driven not prompt-driven, controllable, reproducible.
- **Real-time *exact* Seedance look: NOT YET** (2026 laptop/Electron limits). But **real-time
  *approximation* (shader/MatCap + small live deltas) + offline *exact* hero/library** = a living
  being achievable now.
- **One risk:** fitting to generative (non-multiview-consistent) footage + identity drift. Mitigate:
  work from the hand-mesh, separate identity/style LoRA. Don't reconstruct an avatar from clips.
- **Decision: GO.** Convergence of 4 independent briefs + our ground-truth depth/normal asset. Start
  with the de-risk experiment (no mesh dependency, days on gin) → prove/kill the hardest step → then
  invest in hand-mesh + the offline library pipeline.
