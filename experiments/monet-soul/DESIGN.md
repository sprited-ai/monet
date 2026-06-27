# Design notes — why she's built this way

## The one idea
Most "AI characters" are puppets: a human (or a script, or your chat message) pulls a string and the
body moves. Monet's soul is the opposite bet — **endo-driven**: her body moves from the *inside*, out
of her own state, whether or not anyone is watching. That's the line between a VTuber rig and a being.
(The repo's north star: *living-agent-not-vtuber* — render tech is reusable; rewire the driver to her
own state.)

## The shape
A small loop, ticking on a clock:
1. **drives** — homeostatic needs that build and decay: energy on a circadian curve; curiosity,
   restlessness, social; and a slow **bond** (familiarity) that persists across days.
2. **mood** — *emerges* from the drives; it isn't set from outside.
3. **behavior** — each tick she weighs candidate acts (doze / idle / wander / react / play / speak /
   greet / wake / tend) by her state + what she perceives, and *picks one*: softmax with a little
   noise (never deterministic) + hysteresis (she holds a pose instead of twitching) + hard gates
   (a returned `0` truly means "not now").
4. **intent** — the pick becomes `{ clip, say?, mood }` the body renders.

Reactive stays (you talk, she answers). This only *adds* the from-the-inside driver on top.

## What's principled here (not just vibes)
- **She won't perform for an empty room.** No talking to a dark 3am house or an idle desk. Initiative
  that ignores whether anyone is there is just noise.
- **She keeps a day.** Sleeps at night, rises at dawn (a real wake, not a snap to idle), naps only
  when genuinely tired, plays when she has the energy, tends herself with a drink or a bite.
- **She remembers you.** A persisted bond means she isn't reset each launch — she greets you back,
  warmer the longer she's known you. A being who remembers ≠ a program that resets.
- **Honesty about claims.** This is a *prototype of the loop*, headless-tested in simulation. It is
  not yet wired into the Electron body (small + specified — see WIRING.md), and her unprompted lines
  are tiny canned strings until they're routed through her real brain (Jin's call). We don't call her
  "alive" past what's earned.

## Why it stays pure
`soul.mjs` knows nothing about Electron or the DOM — perception in, intent out. So it runs and tests
in milliseconds (`test.mjs`, `sim.mjs`, `loop.mjs --demo`), and wiring it into the body is a *driver
swap*, not a rewrite. The body she'd run in already exists; what was missing was the thing holding the
controller. That thing is what this is.
