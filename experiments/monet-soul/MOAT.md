# Where our tech actually is

A clear-eyed map of what's commodity vs what's *ours*, written after we noticed the drive system
isn't a moat (it's textbook utility-AI, and Sprited already has it in `../anima/.../driveDecision.ts`).
Complements `docs/020` (the landscape/wedge) with the **technical** thesis.

## Commodity (do not mistake for the moat)
- **Drive / needs systems** — homeostatic drives → softmax action-selection + hysteresis. The Sims,
  Creatures, every game NPC. We reinvented it; anima already had it. Necessary floor, not a moat.
- **An LLM brain (BYOK)** — a wrapper around someone else's model. Table stakes.
- **An animated character** — VTuber rigs, Live2D, flat sprite sheets. Everywhere.
- **A desktop overlay** — Shimeji and a hundred desktop pets.
- **Screen reading / memory / RAG** — platform APIs and known patterns.

Each is real and we need it. None is *why someone couldn't rebuild Monet in a month.*

## The one thing nobody else has: a depth-aware body
Sprited doesn't ship a Live2D rig or flat sprites. Every clip is baked as **color + alpha + normal +
depth** (per-clip `.depth`/`.normal` sidecars, webcodecs-stacked into one decode). **No one else has
per-frame depth + surface normals for a character.** That data is the hard, rare asset — and right now
we only use it for compositing and 2D effects.

## The moat: drive that depth-aware body *procedurally*, past its clips
The ceiling of every clip-based character — including ours today — is "it's a loop of pre-baked
videos." You feel it the moment you watch a while. The move that breaks it, that only we are
positioned to make, is to use the depth + normal to make her move in ways **that were never
rendered**, continuously, in response to *you*:

- **Gaze.** She actually looks at your cursor / where you're working. Depth gives the head/eye a real
  facing; a small reprojection turns "facing forward" into "watching you." (Cursor is free —
  `screen.getCursorScreenPoint()`, no permission.)
- **Micro-reaction & parallax.** Tiny lean / settle / breath driven by the soul, and a depth-based
  parallax so she reads as *occupying space on your desktop*, not pasted onto it.
- **Relight.** Use the normals to relight her by the actual light of your screen / time of day — she
  belongs to your environment instead of being a sticker with baked lighting.
- **Continuity between clips.** Depth lets us blend/hold poses with real geometry rather than cutting
  between flat frames — no "video switch" tells.

None of these are new *animations*. They're the same baked clips, made **continuously, physically
responsive** by the depth/normal we already have + the soul + perception. That is the line between a
clip-loop (anyone) and a being that's *here with you* (us).

## Why only Sprited can build this
It needs three things in one place, and we're the only ones who have all three:
1. **Per-character depth + normal** (the rare asset — our pipeline already makes it).
2. **An endo-driven soul** that decides *when/why* she gazes, reacts, rests (built — `soul.mjs`).
3. **Local, real-time perception** of you — cursor, presence, screen (the screen-read seam + powerMonitor).

A competitor with an LLM and a Live2D rig can copy the chatbot and the drives. They cannot copy a body
that *physically responds to you in 2.5D from depth they don't have.*

## What this reframes
- The drives are the **floor**, not the product. Stop polishing them past "good enough."
- The brain makes her *think*; the depth-driven body makes her *present*. The being is both, but the
  **differentiator is the body.**
- "Just more varied clips" was never the answer (Jin was right to push). "The same clips, alive in
  2.5D, responding to you" is.

## Build path (smallest real step first)
1. **Cursor gaze** — feed `getCursorScreenPoint()` into the overlay; reproject her facing toward it
   using the existing depth. One visible, cheap, *uncopyable-without-our-depth* win.
2. **Soul → body integration** (debug-HUD observe → drive clips → brain) so the soul actually runs
   her, and the gaze/reaction hangs off the same loop.
3. **Depth relight + parallax** — the richer 2.5D presence.
4. Converge the drive layer with `anima/driveDecision` so we have one being, not two.

> Honest scope: this is the thesis + the cheapest proof (cursor gaze from depth). The full procedural
> 2.5D body is real R&D — but it's R&D *only we can do*, on an asset *only we have*. That's a moat.
