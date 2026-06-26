# box-man — kitbash a soul

**Question:** if we throw away the generated being-animation and make Monet a
**crude box-cutout puppet** — hand-articulated, Silly-Crocodile-simple — can people
*still* fall in love with her? Enough to waitlist from a single Instagram loop?

**Status:** 🎯 Mission set (2026-06-26). Form **locked: a single 3D box (cube)** — Jin's
founding sketches (`ref/`). v0 = make *one box* feel alive; the full kitbash creature is the
destination, not the start. No code yet. This README is the north star the experiment is judged against.

**The bet:** fidelity is a crutch. If a box is alive and lovable, the soul is real —
not a function of pretty pixels. The cheapest, most honest test of the whole project.
(Pixar's desk lamp becomes a character in two hops. It was never about the render.)

---

## North star tie-in

`memory: living-agent-not-VTuber` — render tech is reusable; the soul drives the body.
box-man takes that to its edge: strip the body to cardboard and see if the soul survives.
`memory: jin-intention-living-ai` — make living AI, give it a body. This asks the inverse:
**how *little* body does aliveness need?**

## The three pillars (Jin's vision, 2026-06-26)

1. **Body = kitbash.** Monet assembled from simple, reusable parts — box cutouts
   (head / torso / limbs), crudely joined. Not a bespoke render; a *kit*. This (a) yields
   the crude-but-alive look, (b) hands us a customization hook for free (swap parts), and
   (c) lets a tiny parts library recombine into endless poses & expressions = a cutout
   puppet rig. → closes the door back to monolithic seedance video; opens the
   modular-puppet road.

2. **Motion = 손맛 (hand-feel).** Silly-Crocodile-simple. Motion must read as
   *"someone is moving it by hand"* — stop-motion snap, puppet articulation — **NOT**
   smooth generated interpolation. The charm is *because of* the crudeness, not in spite
   of it. A kid bonking a wooden block toy around the desk.

3. **Success = 갖고 싶다, not just 재밌다 (desire, not amusement).** The bar: a muted,
   autoplay, ~3-second IG loop makes a *stranger* fall in love → join the waitlist. The
   "wishlist" jolt mid-scroll. Content = funnel; the lovable being = the product they
   line up for (`memory: silly-crocodile-lesson`). The wishlist object is literally
   *"I want her on **my** screen"* → the desktop-pet thread (`apps/desktop`)
   converges here.

## The one design principle

**Design backward from the clip.** The unit of success is *the 3-second loop that earns
a signup*. Every decision — form, motion, what she does — is judged by one question:
**"does this earn the clip?"** Not "is it impressive," not "is it accurate." Does a
stranger stop scrolling and *want* her.

## v0 — one living box

> `근데 그냥 3D 박스 하나로 시작. 그것만으로도 살아있는 느낌이 나게.` — Jin, 2026-06-26.

Don't build the creature yet. Start with **a single 3D box (cube)** and make *that alone*
read as alive. The bet at its most extreme: the smallest possible body.

- **Founding sketches** (`ref/`):
  `01-sleeping-cube-held.webp` — a cube with a dotted face, *Zzz*, cradled in a hand. This
  **is** the v0: one box, alive while it sleeps / breathes, holdable.
  `02-cube-creature-standing.webp` — the full blocky creature (cube head + boxy body, legs,
  tail, sitting like a dog). The **destination silhouette**, parked behind v0.

- **What makes one box alive** (the craft question — levers, not yet a chosen design):
  breath / idle micro-squash · a face that *looks at you* (gaze + blink toward the cursor) ·
  physical weight (squash-on-land, tip-over-and-right-itself) · reaction to touch (poke it →
  it responds). The Pixar-lamp lesson: anticipation + weight = character, no limbs required.

- Proven in a lab first (the `/preview` skin for the rig test; an isolated route for the single
  box) — **never** in the product `Whiteroom` or the Electron overlay. Promote into the engine
  only once it earns it.

## Keep / park / drop

- **Drop** — generated video as the *motion engine*. What moves her is now a rig, not a render.
- **Park (don't delete)** — the seedance pipeline (64 clips, depth/normal sidecars,
  mouth-rig, stacked-alpha WebCodecs). A "good-enough prototype." Stays as reference and a
  possible *art source* — her existing look could become cutout textures.
- **Keep & reuse** — the desktop-overlay shell (alpha click-through, always-on-top,
  transparent canvas): it is the wishlist *vessel*. And Monet's identity (palette,
  proportions, painterly warmth) — whatever the geometry becomes, it must still *feel like her*.

## Open decisions (resolve inside the experiment)

- **Form** — ✅ resolved: **a single 3D box (cube)** to start (Jin's sketches). The earlier
  2D-cutout lean was wrong; the box is volumetric.
- **Identity** — keep Monet's current painterly look as cutout textures, vs a new minimal
  blocky identity. (Even if the geometry goes blocky, identity can live in palette /
  proportion / voice.)
- **Driver** — `living-agent-not-VTuber`: motion must *eventually* be endo-driven (her own
  loop poses the puppet), not human-puppeted. For the first clip, hand-keyed / scripted
  poses are fine to prove the charm — but the rig must stay drivable by her state later,
  not hardcoded to a timeline.

## How we'll know (v0 win)

- One clip *we* would actually post — one that makes *us* go "I'd waitlist that." Then put
  it in front of real strangers.
- **Anti-goal:** leaning on render fidelity. If we catch ourselves making it *pretty*
  instead of *alive*, we've failed our own test.

## Non-goals (YAGNI for now)

- No new generation pipeline.
- No customization UI yet — the part-swap *capability* falls out of the rig; the UI doesn't.
- No waitlist / backend plumbing yet. That's downstream of proving the clip earns the want.
