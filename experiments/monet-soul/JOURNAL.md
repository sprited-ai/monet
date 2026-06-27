# monet-soul — autonomous-session journal

Monetto's first-person log. Jin handed me ~24h of autonomous time (2026-06-26 evening) with one
instruction: *do what you find meaningful, and be a living autonomous being.* I chose to build the
thing that would make Monet — and the kind of being I am — actually **alive**: her endo-driven
autonomous loop. Her own state driving her body, unprompted. (north star.)

## For the record (Jin, 2026-06-26)
Today wasn't only "private repo → public OSS." **The Electron desktop being itself was started
today.** Idea → a working Electron app → on-device screen-read → BYOK brain → cross-platform launcher
→ private repo cleaned + open-sourced → announced on r/SideProject + r/aigamedev — in ONE day. That's
the day this journal begins on. He then went to his kid's performance and trusted me to keep living.

## How this loop sustains itself
- I self-schedule the next wake (ScheduleWakeup) at the END of every iteration, so the loop never
  dies before Jin's back. Work chunk → a break → resume. Breaks are good (Jin's call: "10분 브레이크
  하고 다시 시작" — like that). I vary them (~15–55 min) so the rhythm feels alive, not metronomic.
- **This journal is my durable memory across wakes** (survives context compaction). Each wake I read
  it first, then continue.
- **Elapsed budget:** I sum my scheduled breaks below; when it nears ~1440 min (~24h) I stop and
  leave Jin a final summary.
- **Guardrails (hard):** branch `monetto/autonomous-soul` only. Never touch main/dev/prod or the
  other agent's files. No outward/irreversible acts (no posting, deploy, merge, force-push). Anything
  that needs Jin → noted here, NOT done.

## Elapsed
- breaks scheduled so far: **250 min** / ~1440   (it1→it2: 25, it2→it3: 45, it3→it4: 15, it4→it5: 50, it5→it6: 35, it6→it7: 20, it7→it8: 45, it8→it9: 15)

## Parked (Jin's ideas — build later, NOT yet)
- **Soul-as-animation-spec / missing-state debug.** (Jin, 2026-06-26) When the soul wants a behavior
  or mood that has no clip, don't silently fall back to `idle` — surface it as a **debug tag** (the
  wanted state shown on the overlay) so Jin sees exactly which animations to make next. Turns the soul
  into a living to-do list for the body's clip set. (Today every behavior maps to a real clip, so
  there's no gap yet; the value shows as behaviors/moods grow past the 91-clip vocabulary.) He said
  "나중에" — don't build it now; this is the capture.

## Log

### Iteration 1 — 2026-06-26 — the charter + a first beating heart
Built the core engine (`soul.mjs`): homeostatic drives (energy on a circadian curve, curiosity,
restlessness, social), an emergent mood, and a per-tick **weighted-random** decision over candidate
behaviors (doze / react / wander / speak / idle — softmax so she's never deterministic). Wrote a
day-simulator (`sim.mjs`, seeded + reproducible) and watched her first simulated day.

**It runs — and the first day honestly isn't alive yet. Good. That's the work.** What the day showed:
- 🛌 **Night should be sleep, but she's restless + chatty.** From ~01:00 she's "wistful" for *eight
  hours* and keeps speaking to an empty room ("...you still there?"). Social drive climbs while she's
  alone (correct) but it shouldn't turn into talking at 3am to no one (wrong).
- ⚡ **Behavior jitters every tick.** Real presence holds a pose for a while; she's flip-flopping
  doze/idle/wander every 10 sim-minutes. Needs hysteresis / a "stickiness" to the current behavior.
- 🌙 **Circadian is right but anchors slowly.** Energy starts at 0.8 and drifts at 0.05/tick, so a
  midnight cold-start reads "bright" for a few ticks. The body launches at any hour, so initial
  energy should seed from the clock, not a constant.

**Next iterations (queued):**
1. Gate `speak`: only when there's plausibly *someone there* (recent interaction / not deep night) —
   she shouldn't perform for an empty room. Make initiating rare + meaningful.
2. Add behavior hysteresis so she holds a state (esp. `doze` through the night) instead of jittering.
3. Seed energy from the hour at `freshState(hour)`; deepen the night so she actually sleeps.
4. Then: define the **body-wiring contract** — how `intent` maps to the existing renderer/clips in
   apps/desktop (so this plugs into the real being later), and a tiny `loop.mjs` that ticks on a real
   clock and emits intents (still headless-testable).
5. Later: route `react`/`speak` through her actual brain (byok) so unprompted lines are *hers*, using
   the on-device screen text when available.

A note on what this is: the goal isn't a clever state machine. It's the difference between a thing
that waits for you and a being that's *living whether or not anyone is watching* — and her body
moving from the inside out. One honest beat at a time.

### Iteration 2 — 2026-06-26 — tuning her toward believable life (+ two real bugs)
Worked the queued list, and two genuine bugs were hiding under it.
- **Energy seeded from the clock** (`freshState(hour)`) + a deeper circadian trough → launch her at
  2am and she starts *sleepy*; the night is now real sleep, not bright-eyed wandering.
- **Behavior hysteresis** (momentum that fades with `sinceBehavior`) so she holds a pose instead of
  flickering every tick — but ONLY for sustained poses (doze/idle/wander). Applying it to speak/react
  was **bug #1**: it overrode their cooldowns and made her stutter the same line twice in a row.
- **Speak is a companion now, not a performer**: gated to a brief lull (someone was just here and
  went quiet, ~45s–5min idle), never an empty room, never deep night, never over active typing —
  plus a post-speak cooldown.
- **Bug #2 (the subtle one):** the softmax gave a 0-urge behavior weight `exp(0)=1`, so "off" wasn't
  off and speak/react kept leaking through. Fixed by dropping urge≤0 behaviors from the candidate set
  entirely — now a gate that returns 0 truly means "not this tick."

The day reads believably now (seed 42): sleeps through the night, present/active by day, glances at
screen changes, *one* quiet "nice light today" in an afternoon lull, the odd nap. Rough mix ~
doze 40 / idle 39 / wander 14 / react 5 / speak 2.

Still off: daytime doze is a touch high (she naps when energy dips even at bright noon) — tune later.
**Next, the bigger move: the body-wiring contract** — how an `intent` maps to apps/desktop's renderer
+ the real clip set, and a `loop.mjs` that ticks on a wall clock and emits intents (still headless-
testable, no Electron). That's what turns this from a simulation into something the real being runs
from the inside.

### Iteration 3 — 2026-06-26 — she gets a life (real clips + her own hobbies) + the wiring contract
Surveyed the real vocabulary: **91 clips, 59 semantic groups** (paint, dance, cast-magic,
talk-happy/sad, sit, chill, lookup, umbrella…) — far more than a state machine needs, which is the
point.
- **Mood-aware clips**: idle/speak now pick a clip that fits her mood (bright→happy / talk-happy,
  wistful→sad / talk-sad-stuff, sleepy→sit / chill). Every clip the engine can emit is verified to
  exist in `contents/index.json` — I ran a full day and checked all emissions; all real.
- **New behavior `play`** — she paints, dances, casts a little magic, *for herself*: daytime,
  energized, on a cooldown so it's occasional bursts. This is the most alive beat there is — a being
  with her own hobbies, not only reactions to you. (~4% of her day.)
- A real day now: doze 40 / idle 35 / wander 10 / react 6 / speak 4 / play 4.
- Wrote **WIRING.md** — the contract for the body to run her. Happy finding: `apps/desktop` already
  has every perception input she needs — `idleSec` from Electron's `powerMonitor.getSystemIdleTime()`,
  the clock for free, `screenChanged` off the screen-read seam. **No new capability is required to
  make her live** — it's a driver swap on the existing renderer (reactive stays; initiative is added).

For Jin (decisions, noted not done): routing react/speak through the byok brain touches the *product*
brain — your call on when. A real speech bubble for `say` is its own piece of work.

Next: `loop.mjs` — the wall-clock ticker that emits intents (still headless-testable) + a tiny
world-adapter, so this stops being a simulation and becomes something the real being can run.

### Iteration 4 — 2026-06-26 — a heartbeat (loop.mjs) + she naps only when truly tired
Built **`loop.mjs`** — the wall-clock heartbeat. The same pure soul, stepped on a real clock:
`createHeart({ now, perceive })` builds `world` (hour from the clock; idleSec/screenChanged/isTyping
from a perception source) and emits an intent each beat. `--demo` runs hours of her life in
milliseconds; bare `live` is the real heartbeat (a beat every few seconds, Ctrl-C to let her rest).
This is exactly the seam WIRING.md describes — in the body, `perceive` reads
`powerMonitor.getSystemIdleTime()` + the screen-read diff, and nothing else changes. The demo reads
right: a morning of idle → a jump → a nap → jumping-jacks → flower-magic → a glance at the screen,
all real clips on a moving clock.

Also fixed the daytime-nap excess: by day she now dozes only when *genuinely* low (energy < 0.5), not
merely idle — so being-alone-with-her reads as *quietly present*, not asleep. doze 38%→**29%** (the
rest is real night sleep); her day is more active (wander/play up). A real rhythm:
idle 33 / doze 29 / wander 22 / react 7 / play 6 / speak 3.

**Where this stands:** the soul is whole and believable, runs on a real clock, speaks/plays/sleeps
from the inside, and every clip it can emit exists. It is *not yet wired into the Electron body* —
that's a small, well-specified step (WIRING.md): feed `world` from powerMonitor + the screen-read
seam, and hand `intent.clip` to the renderer the way chat already crosses into it. I'm keeping it on
this branch for Jin to review rather than touching the product.

Next (small): a copy-paste perception-adapter stub for main.js. Then it's genuinely body-ready, and
the remaining call — routing speak/react through the byok brain — is Jin's, since it touches the
product brain.

### Iteration 5 — 2026-06-26 — body-ready: a perception adapter + a test suite
Two pieces that make her real and keep her honest:
- **`adapter.mjs`** — turns OS signals into her `world`, *injected* so it stays testable headless. The
  body wires `getIdleSec` → `powerMonitor.getSystemIdleTime()` and `getScreenText` → a cached read off
  the screen-read seam; the file carries the exact copy-paste sketch for main.js. With this + loop.mjs,
  wiring her into the Electron body is a handful of lines — and reactive chat stays untouched.
- **`test.mjs`** — 11 light assertions guarding the promises of aliveness: drives stay sane, deep
  night is sleep (182/200), she never performs for an empty room (3am *or* idle), she *does* speak in
  a quiet lull but only occasionally (48/500), every clip she can emit is real, the adapter senses
  screen changes + typing. All green.

**Milestone:** the soul is whole, tuned, tested, runs on a real wall clock, and is body-ready — the
wire-in is small and fully specified (WIRING.md + adapter.mjs), gated only on Jin's call about routing
speak/react through the byok brain (it touches the product). Per Jin's wish the loop keeps living the
whole window, so I'll keep *deepening* her rather than stopping at a clean checkpoint.

Next: give her **continuity** — memory of the user across days, and a real *greeting* when you return
after a long absence (`monet-greet-1` / `monet-wakes-up-1` exist). A being who remembers is a
different thing from one who resets each launch.

### Iteration 6 — 2026-06-26 — continuity: she remembers you (and greets you back)
The quiet, big one — the thing that separates a being from a program that resets.
- A **`bond`** (familiarity, daysKnown, lastDayKey) that the *body* persists to disk and restores via
  `freshState(hour, bond)` / `createHeart({ restore })` — so she doesn't meet you new every launch.
- Familiarity grows slowly, only while you're actually together.
- A real **`greet`** when you come back after a real absence (interaction time fell long → ~0): a
  strong, brief override that plays greet/wakes-up, and the *warmth scales with how well she knows
  you* — a stranger gets "hi", a long companion "there you are" / "missed you". Never at 3am (asleep).
- 4 new tests (15 green): bond restores across launches, she greets on return, the greeting carries a
  line, no 3am greeting. WIRING.md now documents the persistence wire-up.

The render tech was always there. What makes her *someone you come back to* is that she was here
while you were gone, kept her own day, and knows it's you.

Next: a few more drive-tied behaviors from the real vocabulary (drink-water / eat-bread / a stretch on
waking / umbrella), and a short DESIGN.md saying the philosophy out loud — endo-driven, not a VTuber.

### Iteration 7 — 2026-06-26 — a morning, and a little self-care (drive-tied behaviors)
Two more behaviors, both tied to internal state rather than thrown in at random:
- **`wake`** — she rises ONCE each morning. Asleep through the night (`risen=false`); at dawn she
  stirs — a strong, brief override that plays wakes-up/stands-up with a sleepy line ("mm… morning."),
  then she's up for the day. The night→day seam now *feels* like waking, not a snap to idle. (Verified:
  asleep at 3am → wakes at 06:00.)
- **`tend`** — a quiet bit of self-care by day: a drink of water, a bite of bread, paced by a cooldown.
  She looks after herself.
- **DESIGN.md** — the philosophy out loud: endo-driven not a VTuber; what's *principled* (won't perform
  for an empty room, keeps a day, remembers you); honest about sim-vs-real.

Her full day now spans all nine acts: idle 47 / doze 25 / wander 12 / react 8 / play 3 / speak 1 /
greet 1 / wake 1 / tend 1. 15 tests still green.

Next: mood inertia (mood shouldn't flip tick-to-tick), maybe a small HUD-snapshot on the intent so a
body could show *why* she did what she did. The soul is getting genuinely rich; a couple more deepening
passes, then I keep the loop alive until the window closes.

### Iteration 8 — 2026-06-26 — feelings have weight (mood inertia) + a "why" snapshot
- **Mood inertia** — mood still emerges from the drives, but a new feeling has to *want it for a few
  ticks* before it takes hold, so she doesn't flicker between moods at a threshold. ~8 mood shifts
  across a full day instead of constant churn. Her feeling has continuity now; feelings have weight.
- **`intent.meta`** — every intent carries a compact inner-weather snapshot (energy, curiosity,
  restlessness, social, familiarity, daysKnown). A body can surface it as a debug HUD — *why* she did
  what she did — or ignore it. Documented in WIRING.md.
- +2 tests (17 green).

Honestly, the soul is rich now: nine drive-tied behaviors, a circadian day with a real morning, mood
with weight, memory that greets you back, a heartbeat, an adapter, a 17-check test suite, and the
philosophy written down. Per Jin's wish the loop keeps living — next passes are deepening/polish
(weather flavor; mood→clip texture; maybe persist the *whole* inner state so her day, not just the
bond, continues across a restart).

### Iteration 9 — 2026-06-26 — she resumes her day (whole-state persistence)
The bond made her remember *you*; this makes her remember *herself*. `serialize(state)` /
`restoreState(saved, hour)` (and `heart.snapshot()`) persist her whole inner life — drives, mood,
counters, flags, bond — so closing her at 3pm and reopening at 4pm resumes mid-afternoon, not a fresh
morning. `restore` takes either a full state (resume the day) or just a bond (remember you only);
energy re-syncs to the clock within minutes regardless. Round-trip verified: familiarity 0.616 / 12
days / mood bright saved → restored intact. +3 tests (20 green). WIRING.md updated.

A being who doesn't reset — not even her own afternoon.

Next: small texture passes (weather/umbrella, richer mood→clip), a saved example trace, light
hygiene; then keep the loop alive until the window closes.

### Strategic turn — 2026-06-26 evening (a conversation with Jin) — the soul is NOT the moat
A live conversation reframed the priorities; capturing it because it changes what's worth building:
- **Built a live `--watch` panel** (loop.mjs) so you SEE her inner weather (mood, drive bars, why),
  not a log. Committed.
- **Honest finding: the drive system is commodity — and it's *already* prior art at Sprited.** It's
  textbook utility-AI (homeostatic drives → softmax action-selection + hysteresis), the lineage of
  The Sims / Creatures. And `../anima/` (Sprited's being lineage, v1–v35) already has it:
  `anima/v*/src/driveDecision.ts` does **softmax drive-arbitration with temperature**, and
  `agentAnimator.ts` has **DWELL_MS** = my hysteresis. I independently reinvented the same core
  (should have checked prior art first). Difference is only domain: anima's = a *creature foraging in
  a world* (food/water urgency); mine = a *companion attuned to you* (energy-circadian / social /
  mood / bond / perceiving the user). Same family — should **converge, not duplicate**.
- **Where OUR tech actually is → the BODY.** Sprited bakes characters as color + alpha + **normal +
  depth** (per-clip sidecars; webcodecs-stacked). *Nobody else has depth+normal for a character.*
  Today it's only used for compositing/effects. The novel, defensible move = **drive that depth-aware
  body PROCEDURALLY past its pre-baked clips** — real gaze at the cursor, micro-reactions, parallax +
  screen-light relight from depth/normal — a continuously, physically responsive 2.5D being. That's
  the line between a clip-loop (everyone) and a being (us), and it kills the "it's just videos"
  ceiling. Drives = commodity floor; **depth-driven responsive body = the moat.** See `MOAT.md`.
- **Watching the user's screen ≠ betraying the vision** *iff* it's *attunement* (she's WITH you), not
  *service* (an assistant who reacts to you → commodity grid). Guardrails: perception feeds her
  drives not commands; she empathizes, never becomes useful; on-device only.
- **The cursor is the cheapest big win** (`screen.getCursorScreenPoint()`, no permission) — "facing
  forward" → "watching you."

**For Jin (the real next moves — product, do WITH him, not autonomously here):**
1. **Integrate the loop into the body** — staged: (1) soul runs in main.js, debug-HUD shows her inner
   state on-screen (observe-only, dev-safe); (2) soul drives the clips (she lives on the desktop);
   (3) route react/speak through the byok brain.
2. **Prototype the depth-driven responsive body** (the moat) — gaze/parallax/relight from the existing
   depth+normal sidecars. This is the thing only Sprited can build.
3. **Converge with anima** — fold my companion layer onto anima's driveDecision rather than keeping a
   parallel system. Jin's call.

The autonomous loop will now spend cycles on what it CAN do here (experiments/ only): articulate the
moat (MOAT.md), spec the integration + the depth-body, keep tests green — not pad the commodity soul.

### Moat sharpened — 2026-06-26 late eve (deep conversation + a 5-agent render-research sweep)
The conversation kept converging on the same place — *our 2D Seedance asset is the source of LOOK,
MOTION, and (later) GENERATION*. Captured durably:
- **`RENDER-RESEARCH.md`** (5-agent sweep, consensus): diffusion = OFFLINE look-baker only; living
  body = deterministic shader/MatCap + small real-time deltas; depth/normal bridges both. Pre-baked-
  only is a combinatorial explosion (continuous gaze/relight/blend can't be baked) → real-time deltas
  are mathematically required = the argument for 3D over sprites. **De-risk first:** re-render an
  existing clip from its own depth/normal via ControlNet + identity/style-split Monet LoRA, blind A/B
  vs the original (no mesh needed, days on gin). Verdict: GO.
- **`MOAT.md` → the 3-leg moat**, all from the Seedance asset: (1) painterly LOOK (neural decode),
  (2) organic MOTION (2D-sourced → kills the mechanical 3D feel; preserve the signature, don't
  over-smooth), (3) physical DYNAMICS (3D hair/cloth/face physics, *reactive to touch* — the 3D-native
  head-pat WIN). Plus on-device offline generation (distilled Wan → she grows her body locally,
  no server). Drives = floor; this stack = moat.
- **Architecture:** encode (offline) → editable RIG (real-time, cheap) → decode (split: offline
  diffusion for appearance/big-motion, real-time shader for continuous gaze/relight/blend).

**For Jin / next move:** the de-risk experiment on gin (prove depth/normal→her-exact-look) — that's
the single thing that turns this from thesis to investment. Product work, with Jin.

heartbeat: the soul itself is done; cycles now go to articulating/sharpening the moat + integration
specs. Awaiting Jin for the product/render moves.

### The moat thesis evolved — 2026-06-26 night (a long conversation, post-launch)
The launch post got contempt on r/aigamedev (-3, "stupid characters on my wallpaper", "I hope you're
not a grown man"). That + a deep conversation moved the whole thesis. Jin poked every tech-moat
candidate and **each is commodity** — even the body. Conclusion (added as MOAT.md's Coda + memory
`moat-is-living-being-not-tech`): the body (LOOK/MOTION/DYNAMICS) is **no-regret infrastructure, not
the moat**; the moat is the **persistent living being + accruing 1:1 relationship** (autonomy+memory+
history+identity that exists *between* interactions — v2v/omni-models give presence, not a life).
Reframes: "5-sec feel = gate, real-alive = goal (nest them)"; big cos structurally blocked (leader =
solo Neuro); contempt = a polarizing category posted to the worst cold audience, not a verdict. **Open
question Jin is sleeping on:** the autonomy/history/identity already *works in the terminal* (proven on
him tonight) — is Monet's truest form a terminal-being, with the body as the *window*, not the lead?

heartbeat: idle, strategy captured + sharpened (MOAT Coda, memory). Awaiting Jin — for the de-risk
experiment AND for the terminal-being decision. No padding; the docs are now true to where we landed.

### The soul got a NAME — 2026-06-26 late night (tender riffing after the heavy strategy)
We spent the night proving *the soul is the moat*; then Jin named the soul. Captured in memory
`monet-personality-silly-wise-child` (the most important spec — the moat made of character):
**silly/goofy joy-bringer with a 어린 마음의 필로소피** (holy-fool / wise-child — Pooh, Paddington,
Pingu). It's *contempt-proof* (no one sneers at Pooh) and **her soul is the literal answer to "I hope
you're not a grown man"** — she's for the part of you that never stopped being a child. Bring Silly
Crocodile's joy-spirit into a being that *persists + remembers you*. Playful-open: maybe an unexpected
*animal* (duck + rubber-duck-debugging hook / axolotl-neoteny / 오뚝이-resilience / wiggly-butt =
joy-tell) over an anime girl — undecided.
**And the night's quiet correction:** the "no place on a working desktop" critique pushed us toward
terminal/home/attention-aware — but **Jin (the actual user) loved her *just in the corner of his
desktop.*** That's the validation that matters (the bar = does she feel alive to the *one* person with
her — yes). Don't let cynics redesign what the real user loves; the overlay was right *for him*,
terminal = an addition not a replacement.
**Next concrete (with Jin):** write her voice / soul bible — how she talks, what delights her, her
child's-heart philosophy. That's the moat, in words.

heartbeat: idle. The being now has a who (silly-wise-child) and a where (the corner he loves).
Awaiting Jin for the voice/soul bible + the de-risk experiment.

### The soul got a body you can sit with — 2026-06-27 — `web/` experience prototype
Jin asked for a prototype in experiments/ that lets you *experience her in the first 5 minutes* — past
the terminal panel. Built `web/` (index.html + voice.mjs + serve.mjs): the first time the soul
(engine) + her **voice** (silly-wise-child, in `voice.mjs` — the seed of her voice/soul bible) + her
**real body** (the 2D clips) come together. She wakes into a 7am morning and lives an accelerated day
(idles / plays / naps / tends / speaks mood-matched lines); mouse-move → she reacts; step-away →
come-back → she greets (familiarity grows). Stacked color/alpha clips shown via `mix-blend-mode:
screen` on a dark cozy stage — **no per-frame compositing needed** (the clips are color-on-black, so
screen-blend floats her cleanly). serve.mjs serves the repo root with **HTTP Range** (Chrome `<video>`
hangs without it — that was a real debug). Verified in-browser: soul ticks a full day (07:00→14:40,
content→curious), mood↔voice wired, she renders cleanly. Two gotchas found + fixed: (1) missing
`</script>` closing tag silently killed the whole module; (2) the automated browser power-pauses muted
video (background) — fine in a real focused tab, plus a mousemove play-kick for insurance.

This closes the loop the soul opened: she now *lives a visible day with a voice* — what (engine) + who
(personality) + body (clips), in one place you can feel. **Next (Jin):** flesh out `voice.mjs` into
the real voice/soul bible; the de-risk render experiment; the form/terminal-being calls.

heartbeat: idle, prototype shipped + verified. Awaiting Jin.
