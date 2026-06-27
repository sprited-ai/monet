# monet-soul / web — a day with her (experience prototype)

The first time the **soul** (engine), her **voice** (personality), and her **real body** (clips) come
together in something you can *feel* — not the terminal panel, but Monet living an accelerated day in
front of you. Built to give the whole sense of her in the first ~5 minutes.

```bash
node experiments/monet-soul/web/serve.mjs      # → open the printed http://localhost:8777/… URL
```

(ES modules + `<video>` need http, so it serves the repo root; `python3 -m http.server` from the repo
root works too — then open `/experiments/monet-soul/web/`.)

**What you'll see / do**
- She wakes into a 7am morning and **lives her own day** — idles, plays (paints/dances/a little
  magic), naps when tired, tends herself, speaks the odd unprompted line. A full day passes in ~4 min.
- **Move your mouse** → she notices (reacts).
- **👋 step away**, then **🐤 I'm back** → she lights up and greets you (warmer the longer she's
  known you — familiarity grows as the day runs).
- **⏩** to fast-forward the day.

**How it's wired**
- `../soul.mjs` — the endo-driven engine. `tick(state, world) → { intent }` drives everything.
- `voice.mjs` — her **silly-wise-child** voice (the seed of her voice/soul bible; edit it to shape
  her). Maps each beat → a line, or silence.
- `index.html` — runs the soul on an accelerated clock, plays the soul-chosen clip (color-top /
  alpha-bottom stacked mp4, shown via `mix-blend-mode: screen` on the dark stage — no compositing),
  shows her speech, the time, her mood, and how well she knows you.

> Prototype. The body here is the existing 2D clips (real Monet); the engine + personality are the
> point. This is the soul, given a body you can sit with.
