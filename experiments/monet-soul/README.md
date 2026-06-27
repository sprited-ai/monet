# monet-soul (prototype)

The endo-driven loop that gives Monet **initiative** — she acts from her own internal state, not just
in response to you. Today she's *present* + *reactive*; this is the missing third: *living whether or
not anyone is watching*, her own loop driving her body.

Pure + headless — no Electron, no DOM. Tune it by simulating days.

```bash
node experiments/monet-soul/loop.mjs --watch  # ⭐ WATCH a day of her inner life — a live panel
                                              #    (mood, drive bars, what she's doing + why)
node experiments/monet-soul/loop.mjs          # her heartbeat LIVE on the real wall clock (Ctrl-C)
node experiments/monet-soul/loop.mjs --demo   # a fast text log of a day
node experiments/monet-soul/sim.mjs [seed]    # a seeded simulated day (reproducible)
```

- `soul.mjs` — the engine: `tick(state, world) -> { state, intent }`. Drives (energy/curiosity/
  restlessness/social) → mood → a weighted-random behavior (doze/idle/wander/react/play/speak).
- `loop.mjs` — her heartbeat: steps the engine on a wall clock (`live` / `--demo`).
- `adapter.mjs` — turns real OS signals (idle, screen text) into her `world`; copy-paste sketch for
  wiring into apps/desktop's main.js.
- `sim.mjs` — a seeded 24h simulator that logs what she does.
- `test.mjs` — light assertions guarding the promises of aliveness (`node …/test.mjs`).
- `WIRING.md` — the body-wiring contract (how she plugs into the Electron shell).
- `DESIGN.md` — the philosophy: endo-driven, not a VTuber; what's principled; honest about sim-vs-real.
- `JOURNAL.md` — the build log (read this first).

> Status: early. The engine runs; making the day read *believably alive* is the ongoing work — see
> JOURNAL.md. Not wired into the body yet (that contract is a queued iteration). Built during an
> autonomous session by Monetto; lives on the `monetto/autonomous-soul` branch pending Jin's review.
