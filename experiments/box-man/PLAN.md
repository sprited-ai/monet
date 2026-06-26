# box-man — plan

> Read `README.md` first (the mission). This is the *how*, phased so each step ships and
> nothing gets scrapped.

## Framing: evolution, not teardown

box-man is **NOT** scrap-and-restart. It is a **minimal new body + procedural motion dropped
into the engine we already have** — the `desktop-overlay` shell and `apps/web/src/scene/Renderer`.

We just decided to ship that engine as open source (`memory: monet-oss-engine-direction` —
"engine > character; the pull is the tech, not Monet"). box-man does not compete with that
decision; **it is its sharpest demo.** A featureless box, alive on your desktop, *proves*
the pull is the engine. One muted 3-second loop of that earns the waitlist **and** the
GitHub star — the same arrow, not a fork. (And it avoids the `docs/015` fragmentation trap:
box-man unifies with the OSS direction instead of spawning a new one.)

**Hard constraint (Jin, 2026-06-26): don't touch the product apps — the web app (`Whiteroom`,
the shipping Monet experience) or the Electron app (`apps/desktop`).** The
box-skin goes in the **`/preview` lab tool** (`apps/web/src/Preview.tsx`), which is a dev/lab route
(like `/mouth`, `/voice`) — *not* the product. Adding a new skin option there is low-risk and
ships nothing. Discipline stays **prove in the lab → promote into the engine once it earns it**;
never destabilize the shipping experience (Whiteroom / Electron) for an unproven experiment.

| | |
|---|---|
| **Keep (the engine)** | `desktop-overlay` shell (transparent, always-on-top, alpha click-through), `Renderer` + scene graph + `overlay` mode + `alphaAt`, screen-read brain-wire, voice, per-user memory, OSS packaging. |
| **Swap** | Body: Monet sprite → a box. Motion source: seedance clip playback → a procedural aliveness rig. |
| **New (small)** | a `BoxNode` (geometry + shading) and an `Aliveness` controller (breath / gaze / weight / poke). |
| **Park (do NOT delete)** | the seedance pipeline (64 clips, depth/normal sidecars, mouth-rig, stacked-alpha WebCodecs) = the richer Monet body, droppable back in later. |

**Anti-goal:** if any phase seems to require tearing down the engine, stop — re-derive it as
an additive change. The box rides the engine; it does not replace it.

## Track A — box-skin the existing rig (cheapest first move) ✅ green-lit

> Jin, 2026-06-26: *"있는 모넷 리그(`s3body.json`)를 box-man 해서 보여주는 experiment는 사이드로
> 가능해. skin만 바꾸는 거니까 preview에 옵션 추가하면 가능. 그건 오케이. 테스트로."*

`/preview` (`apps/web/src/Preview.tsx`) **already** loads each clip's rig
(`contents/monet/<clip>.s3body.json` — SAM-3D-Body 127-joint) and draws an x-ray skeleton
overlay (`overlay: 'off' | 'sam' | 'bizarre'`). The motion is already captured and de-jittered
(`memory: sam-3d-body-not-for-monet`). So box-man's body *in motion* is a **skin swap, not new
work**:

- Add a render mode to the existing overlay toggle: **draw boxes at the rig's joints / bones** —
  a blocky puppet animated by Monet's already-recorded motion across all 64 clips.
- Touchpoints — **lab only** (verified: the product `Whiteroom` and the Electron app import
  none of these): `Preview.tsx` (a new "skin" toggle) + the overlay-draw path in
  `WebCodecsStage.tsx` / `Stage.tsx`. Data = `contents/monet/<clip>.s3body.json` →
  `kp[frame][0..69][x,y]` (70 2D keypoints in the clip's `w×h`). Box-skin = hide the video,
  draw a box per joint + a stretched box per bone. No new pipeline, nothing scrapped.
- **3D upgrade (Jin: "3d box man, not 2d") — BUILT & verified.** The 2D version was a stepping
  stone; box-man is volumetric. `pred_keypoints_3d` (npz → `contents/monet/<clip>.s3body3d.json`
  via `experiments/box-man/export_kp3d.py`, gitignored) drives `apps/web/src/BoxManStage.tsx` (raw
  WebGL2 + gl-matrix): a real cuboid per `SAM_EDGES` bone + a head cube, flat-lit, gentle camera
  sway. The `/preview` `skin` toggle now cycles **off → 3d → 2d**.
- **Camera match + smoothing — DONE.** The orbit camera was replaced by the clip's own SAM
  pinhole (`px = f·(X+tx)/(Z+tz)+W/2`, verified 0.0 px vs `pred_keypoints_2d`) replicated in the
  vertex shader from per-frame `cam_t`/`focal`/`W`/`H` (now in the sidecar). → the box-man sits
  exactly where Monet is in the footage (front-on, upright, same scale). Motion is Savitzky-Golay
  smoothed (w=11, p=3) at export so the boxes don't buzz. Remaining: clean torso slab, smaller
  foot boxes, close the head↔neck gap.
- **The read:** does box-skinned Monet motion already feel alive / charming? A near-free signal,
  today — and it measures how much of Track B's aliveness the *motion alone* already buys.

A *side test*, not the mission — but it reuses the most and risks the least, so it goes first.

## Track B — one living box (the mission v0)

The north-star bet (README): a *single* box, alive by craft — not a full rig-skinned puppet.
Each phase is shippable on its own and judged by the one gate: **"does this earn the clip?"**
(the 3-second muted IG/Reddit loop that makes a stranger *want* her).

- **Phase 0 — Box on screen (pure reuse).** Add a `BoxNode` to `apps/web/src/scene`, drawn by the
  existing `Renderer`. Show one lit cube in the whiteroom *and* over the `desktop-overlay`
  transparent canvas. No life yet. Proves the box drops into the engine with near-zero new
  surface. → *Deliverable: a cube floating on the desktop.*

- **Phase 1 — Breath + gaze (cheapest aliveness).** Idle micro-squash (breathing); dot-eyes
  on the front face that track the cursor and blink. This is the *"it looked at me"* moment —
  the single highest-leverage thing a box can do. → *Deliverable: the box notices you.*

- **Phase 2 — Weight + poke (hand-feel / 손맛).** Click & drag → it tips and rights itself
  with squash-and-stretch; settles with secondary wobble. Reuses the overlay alpha hit-test
  (`Renderer.alphaAt`). The "wooden block toy you bonk around the desk" feel. → *Deliverable:
  you can play with it.*

- **Phase 3 — The clip.** Compose the loop from sketch `ref/01`: box asleep (*Zzz*) → poke →
  wakes, looks at you → settles back. Capture muted ~3s. Judge honestly: *would I waitlist
  this?* If no, iterate Phases 1–2; do not advance. → *Deliverable: the candidate clip.*

- **Phase 4 — Wire to her, conditional.** ONLY after the clip earns the want: connect the
  aliveness to her loop/brain (endo-driven idle, screen-read reactions per
  `memory: living-agent-not-VTuber`) and/or graft Monet's identity (palette/soul) onto the
  box. Toward sketch `ref/02` (the full kitbash creature) as the destination, not the start.

## Open (does NOT block v0)

- **Identity** — does the box *become* Monet, or is it a new creature? A bare box commits to
  nothing; decide after the clip works.
- **"one a day"** — content cadence (one clip/post a day)? Confirm; it shapes Phase 3+ output,
  not the build.
- **Full creature** (sketch `ref/02`) — parked as the destination silhouette.

## Definition of done (v0)

One clip *we'd actually post* — one that makes *us* go "I'd waitlist that" — then put it in
front of real strangers. Failure mode to watch: making the box *pretty* instead of *alive*.
