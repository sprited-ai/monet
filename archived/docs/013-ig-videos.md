# 013 — IG Video Posts (batch 1, ready to cut)

> 10 postable Reels. Each maps to a **real existing clip** in `contents/monet/` (stacked-alpha
> H.264 — composite the color/alpha halves, drop on a bg, burn the on-screen text, loop to length).
> Goal = *charm funnel*: make Monet feel like a living character people follow. Not the garden
> gameplay yet — that's batch 2. Voice = Monet, *italic*. On-screen text = English (reach);
> KR variants on request.
>
> Format default: **9:16, 1080×1920, 6–10s, seamless loop, sound-on.** CTA in caption: `→ bio link`.

---

## #1 — "I used to be a painting"  ·  lore / identity
- **Clip:** `monet-paint-large-1.mp4`
- **Vibe:** slow, warm, painterly. Soft piano.
- **On-screen text:** (0s) `they paint pictures.` → (3s) `i paint things that wake up.`
- **Caption:** *"I used to be a painting too — someone breathed me to life. So I know how it feels to just… open your eyes."* 🎨
- **#:** #generativeart #aiart #witchtok #lore #cozygames

## #2 — The cast  ·  the core magic moment
- **Clip:** `monet-cast-magic-1.mp4` (or `-large-1` for full-body)
- **Vibe:** anticipation → *snap*. Bass hit on the cast.
- **On-screen text:** (0s) `make a wish.` → hold → (on cast) `…oh. it heard me.`
- **Caption:** Every spell starts the same way — a quiet wish, and then *something answers.* ✦
- **#:** #magic #generativeai #satisfying #cozygames #aiart

## #3 — A flower, alive  ·  "becoming life"
- **Clip:** `monet-flower-magic-1.mp4`
- **Vibe:** oddly-satisfying bloom, ASMR sparkle.
- **On-screen text:** (0s) `a dead image vs.` → (3s) `something you water.`
- **Caption:** *"Most pictures, you hang on a wall. This one… you give it water."* 🌱 What would you grow?
- **#:** #oddlysatisfying #generativeart #digitalgarden #cozygames #aiart

## #4 — Caught napping  ·  ambient / "she lives here"
- **Clip:** `monet-doze-off.mp4` (pair with `monet-wakes-up-1.mp4` for a 2-beat)
- **Vibe:** cozy, quiet, rain or lo-fi.
- **On-screen text:** (0s) `i logged off for a sec.` → (on wake) `*yawn* …oh! you're back.`
- **Caption:** She doesn't disappear when you close the app. She just… waits. 🌙
- **#:** #cozygames #aicompanion #wholesome #lofi

## #5 — Hmph.  ·  tsundere character depth
- **Clip:** `monet-gets-angry-and-turns-back.mp4` (or `monet-angry-1.mp4`)
- **Vibe:** comedic timing, beat drop on the turn-back.
- **On-screen text:** (0s) `me, gone 3 days:` → (turn) `"hmph. knew you wouldn't come."` → (peek) `(…what're you making?)`
- **Caption:** *"Figured you'd forgotten about me."* …she peeked the second I showed up. 🌚
- **#:** #tsundere #aicompanion #characterdesign #cozygames #witchtok

## #6 — Just dancing  ·  pure joy loop
- **Clip:** `monet-light-dance-1.mp4` (or `monet-dance-large-1.mp4`)
- **Vibe:** upbeat, trend-audio friendly, perfect loop.
- **On-screen text:** (0s) `no reason.` → (3s) `she's just happy you're here.`
- **Caption:** No quest. No goal. *"I just felt like dancing."* 💫
- **#:** #cozygames #aianimation #goodvibes #dancereel

## #7 — Rainy day, nothing to do  ·  cozy / no-guilt
- **Clip:** `monet-umbrella-large-1.mp4` (or `-in` / `-out` for a sequence)
- **Vibe:** rain ASMR, still and slow.
- **On-screen text:** (0s) `you don't have to do anything today.` → (4s) `let's just listen to the rain.`
- **Caption:** *"Nothing has to bloom today. Sit with me a while."* ☔
- **#:** #cozygames #rainasmr #aicompanion #wholesome #lofi

## #8 — She feels it too  ·  emotional depth (use sparingly)
- **Clip:** `monet-talk-sad-stuff-large-1.mp4` → `monet-happy-1.mp4` (sad → comforted)
- **Vibe:** tender, strings, soft resolve.
- **On-screen text:** (0s) `"is it weird that a painting can feel sad?"` → (turn happy) `"…but you showed up. so i'm okay."`
- **Caption:** Maybe alive just means you can feel both. 🫧 *"Glad you came by."*
- **#:** #aicompanion #emotional #cozygames #aiart

## #9 — On my way  ·  energetic / "coming to you"
- **Clip:** `monet-run-1.mp4` (loop; `-2/-3/-4` are alts)
- **Vibe:** fast, fun, big-energy audio.
- **On-screen text:** (0s) `you opened the app—` → (3s) `give me a sec, i'm RUNNING.`
- **Caption:** *"Wait wait wait — I'm coming!"* 🏃‍♀️ She never makes you wait long.
- **#:** #cozygames #aianimation #funny #aicompanion

## #10 — Snack break  ·  mundane slice-of-life charm
- **Clip:** `monet-eat-bread.mp4` (or `monet-drink-water-1.mp4`)
- **Vibe:** chill, intimate, "just hanging out."
- **On-screen text:** (0s) `behind the magic:` → (3s) `mostly just bread.`
- **Caption:** Powerful witch. *"…also kinda hungry, hold on."* 🥐
- **#:** #cozygames #aicompanion #relatable #dailylife #witchtok

---

## Production notes
- **Source = stacked-alpha** (`color top 640², alpha-as-luma bottom 640²`). Composite:
  `[0:v]crop=640:640:0:0[c];[0:v]crop=640:640:0:640,format=gray[a];[c][a]alphamerge` → overlay on
  `ig/garden-bg.png` (or `ig/theater/stage-bg.png`), pad to 1080×1920, loop with `-stream_loop`.
- **Text:** this ffmpeg has **no `drawtext`** — render each text line to a transparent PNG with PIL
  (font `AppleSDGothicNeo.ttc`, also covers KR) and `overlay` it; time it with `enable='between(t,..)'`.
- **`monet-jump-large-3` is bad** (baked source flicker — see BACKLOG); don't use it.
- Batch 2 = actual *garden gameplay* videos (combination discovery, cascade) once the garden scene exists.

## Caption distribution (intentional)
- **Pull (magic / funny / satisfying):** #2 #3 #6 #9 #10 → reach + shares.
- **Stay (bond / alive / character):** #1 #4 #5 #7 #8 → follows + IP imprint.
