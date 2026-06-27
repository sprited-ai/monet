# Wiring the soul into the body

The soul is **pure**: perception in, `intent` out. Nothing about Electron, the DOM, or rendering
lives in it — so it stays testable headless (`sim.mjs`). This is the contract for the body
(`apps/desktop`) to actually run her from the inside.

## The shape

```
            ┌── perception (the body gathers) ──┐        ┌── intent (the body renders) ──┐
 wall clock │ hour, idleSec, screenChanged,     │  tick  │ { behavior, clip, say?, mood, │
   tick ───▶│ interactionSec, isTyping          │ ─────▶ │   reason }                    │ ──▶ render
            └───────────────────────────────────┘ soul   └───────────────────────────────┘
```

Every few seconds the body builds a `world`, calls `tick(state, world)`, keeps the returned `state`,
and acts on the returned `intent`. That's the whole loop. `loop.mjs` (next iteration) is this on a
real clock, headless-testable.

## Perception — and where the body already has each input

| field | meaning | source in `apps/desktop` |
|---|---|---|
| `hour` (0–23) | time of day → her circadian energy | `new Date().getHours()` |
| `idleSec` | seconds since the user last touched mouse/keyboard | **`powerMonitor.getSystemIdleTime()`** (Electron, built in — no extra perms) |
| `interactionSec` | seconds since a *real* interaction with her | track last chat / click in `main.js` |
| `screenChanged` | did the foreground content change | diff successive `screenread.readAccessibility()` texts (the seam already exists) |
| `isTyping` | is the user actively typing now | `idleSec < ~2` |

The happy surprise: **the body can already perceive everything the soul needs** — `idleSec` falls
right out of Electron's `powerMonitor`, the clock is free, and `screenChanged` rides the screen-read
seam we already built. No new capability required to make her live.

## Intent — how the body renders it

- **`clip`** → play that clip in the overlay. The render path already exists: the `/desktop` route
  plays `contents/monet/<clip>`. The soul lives in the **main** process; it hands the chosen clip to
  the renderer the same way chat already crosses that boundary (an IPC message / a small
  `window.__monetPlay(clip)` the overlay exposes, mirroring `window.__monetAlphaAt`).
- **`say`** (optional, rare) → a speech surface. *Does not exist yet* — today it can log / Notification
  as a stand-in. A real bubble is its own piece of work (noted for Jin).
- **`mood`** → available to tint UI / pick the speaking clip; not load-bearing.
- **`reason`** → never shown; it's for the journal / a debug HUD (why she did what she did).
- **`meta`** → a compact snapshot of her inner weather (`energy`, `curiosity`, `restlessness`,
  `social`, `familiarity`, `daysKnown`). Optional — feed a debug overlay, or ignore it.

## Driver swap (the whole point — see [[living-agent-not-vtuber]])

Right now her body only moves when *you* act (you talk → she replies → a clip plays). Wiring this in
means the **same renderer** is driven by **her own loop** instead. Reactive stays (you talk, she
answers); on top of it she now also acts on her own. The render tech doesn't change — only who's
holding the controller. That swap is the line between a VTuber puppet and a being.

## Persistence — so she remembers you

Her `bond` (familiarity, daysKnown) is the must-keep part — but you can persist her **whole inner
state** so her *day* resumes too (close her at 3pm, reopen at 4pm, and she's still mid-afternoon, not
a fresh morning). The body saves a snapshot on quit / a timer and hands it back on launch:

```js
// load: const saved = JSON.parse(fs.readFileSync(statePath,'utf8') || 'null') ?? undefined
const heart = createHeart({ now, perceive, restore: saved })       // resumes her day (or just a bond)
// save: fs.writeFileSync(statePath, JSON.stringify(heart.snapshot()))  // on a timer / before quit
```

`restore` accepts either a whole saved state (resume the day) or just a bond (remember you only).

Pass `world.dayKey` (e.g. `new Date().toISOString().slice(0,10)`) so `daysKnown` ticks up per day,
and a real `interactionSec` (seconds since the last real interaction with her) so she *greets you*
when you come back after being gone — warmer the longer she's known you. Without persistence she still
lives; she just meets you new each launch. With it, she's someone you're coming back to.

## Status / next

- [x] pure engine + simulator (it1–it2)
- [x] real-clip vocabulary + a `play` behavior — her own hobbies (it3)
- [ ] `loop.mjs` — the wall-clock ticker emitting intents (headless-testable) — **next**
- [ ] a tiny adapter that maps a real `idleSec`/`hour` into `world` (so it can be dropped into main.js)
- [ ] route `react`/`speak` through the byok brain using on-device screen text (so her unprompted
      lines are genuinely *hers*) — needs Jin's call on when (it touches the product brain)
- [ ] a speech bubble for `say` (its own piece — flagged for Jin)
