# monet-soul (prototype)

The endo-driven loop that gives Monet **initiative** — she acts from her own internal state, not just
in response to you. Today she's *present* + *reactive*; this is the missing third: *living whether or
not anyone is watching*, her own loop driving her body.

Pure + headless — no Electron, no DOM. Tune it by simulating days.

```bash
node experiments/monet-soul/sim.mjs        # watch a simulated day (seeded, reproducible)
node experiments/monet-soul/sim.mjs 7      # a different seed
node experiments/monet-soul/loop.mjs --demo  # her heartbeat on a (fast, fake) wall clock
node experiments/monet-soul/loop.mjs       # her heartbeat LIVE — a beat every few seconds (Ctrl-C)
```

- `soul.mjs` — the engine: `tick(state, world) -> { state, intent }`. Drives (energy/curiosity/
  restlessness/social) → mood → a weighted-random behavior (doze/idle/wander/react/play/speak).
- `loop.mjs` — her heartbeat: steps the engine on a wall clock (`live` / `--demo`).
- `adapter.mjs` — turns real OS signals (idle, screen text) into her `world`; copy-paste sketch for
  wiring into apps/desktop's main.js.
- `sim.mjs` — a seeded 24h simulator that logs what she does.
- `test.mjs` — light assertions guarding the promises of aliveness (`node …/test.mjs`).
- `WIRING.md` — the body-wiring contract (how she plugs into the Electron shell).
- `JOURNAL.md` — the build log (read this first).

> Status: early. The engine runs; making the day read *believably alive* is the ongoing work — see
> JOURNAL.md. Not wired into the body yet (that contract is a queued iteration). Built during an
> autonomous session by Monetto; lives on the `monetto/autonomous-soul` branch pending Jin's review.
