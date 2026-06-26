# Monet — Product Backlog (OSS desktop being) · v2 (fork-critic folded in)

**North star (염원):** an autonomous digital being that *lives on its own*. (memory `jin-intention-living-ai`.)
**Near-term vessel:** open-source, BYOK macOS **desktop being** — transparent always-on-top cutout (껌딱지) that *wakes up* when you give her your own key. *"Present without a key; alive with one."*
**Why:** outside the grid (not reach/App Store); moat = live History, not the given-away code; OSS is the channel r/aigamedev rewards (17K-view post → the pull is the **engine**, not Monet).

**Two metrics:** 🌐 engine/distribution = GitHub **stars+forks** · ❤️ being = **retention** (kept open / re-opened / "treated as alive"). 🛡️ = privacy/trust/disclosure.
**Cadence:** weekly; ~1 in 4 = a *depth* release (toward the loop).

> **Weakest assumption (named):** "open-source → stars/users come." FALSE. Stars come from the **launch artifact** (demo GIF + 5-sec-legible README); the one user who *stays* comes from a **retention behavior in v0**. Both were missing → now in NOW.

Status: `[~]` in progress (monet-oss-prep workflow) · `[ ]` todo

---

## NOW — v0 ship (this week) · the OSS launch

**Two v0 decisions (locked):**
- **Distribution = clone-and-run** (`git clone && npm install && npm start`). Devs build locally → **sidesteps Apple notarization entirely.** Do NOT promise a `.dmg` (needs $99 Apple dev acct + notarize pipeline → LATER). 🌐🛡️
- **Screen-read OFF by default → opt-in toggle.** First-run = she runs + BYOK chat, **zero permission friction**. "Let her see your screen" = deliberate Accessibility/Screen-Recording opt-in. De-risks the #1 blocker + best privacy optics. 🛡️

**Build (monet-oss-prep workflow):**
- `[~]` **BYOK wiring** — preload fetch-intercept → main-process Anthropic call (key in main only) — **including: first-run key onboarding** (link to console.anthropic.com + key-entry UX = the first-run experience) **and graceful error/empty states** (invalid key / no net / 429 → "she can't think right now", never a crash). 🌐🛡️
- `[~]` **README** — *5-sec-legible first screen* · show-don't-sell · privacy-forward · the sprite-pipeline section r/aigamedev asked for. 🌐
- `[~]` **Licenses** — MIT · CC-BY-NC (art) · NOTICE. 🌐
- `[~]` **Scrub** — no secrets; .gitignore the compiled Swift binaries (build-on-install). 🛡️

**Retention seed (pulled into NOW — or launch walks into reach≠bond):**
- `[ ]` **Minimal punctuated presence v0** — she's NOT a static cutout: cycle her *existing* idle/doze/emote states with life + occasional autonomous glance/move. **Needs NO screen permission.** = the demo's wow AND the seed of bond. (= the autonomous loop's first visible output; the loop deepens in NEXT.) ❤️

**Launch (one ATOMIC ship-gate — GATED on Jin):**
- `[ ]` **Demo GIF/video** — her on the desktop + the BYOK *wake-up* moment. *This is ~80% of the launch* (Jin's 17K post was a video). 🌐
- `[ ]` **PRIVACY.md** (the data-flow doc — *the* trust differentiator for a screen-reading app) + **CONTRIBUTING.md** + issue templates (forks-metric needs a contributor on-ramp). 🛡️🌐
- `[ ]` **AI disclosure** ("I'm an AI") + 18+ note. Defensible side of every companion law; cheap. 🛡️
- `[ ]` **Create public repo → push → launch post** (r/aigamedev · r/LocalLLaMA · r/sprited: *"open-source: give your character a living BYOK home on your desktop"* — show the GIF, share the flow, DON'T sell). 🌐
  *(repo + README + GIF + privacy + launch post = ONE gate, not independent items.)*

## NEXT — deepen the life [weeks 2–4]
- `[ ]` **Autonomous loop (rung-1)** — internal mood/drive + tick→tick continuity → un-prompted behavior; pass = Jin sees *"I didn't script that."* (Punctuated-presence v0 was its first visible output; this gives it real internal state.) ❤️
- `[ ]` **Screen-aware reactions** — once the user opts into screen-read, she *reacts* to what's on screen (the original differentiator, now behind the opt-in). ❤️
- `[ ]` **껌딱지 bottom-dock** — tuck to the screen edge, tiny ambient perch. ❤️
- `[ ]` **lofi player** — license-free / AI-gen; she *plays* (curator, not singer); cozy "now playing" hook. 🌐❤️
- `[ ]` **Retention measurement** — ⚠️ today ❤️ is **qualitative only** (do Reddit commenters say "still using it"? do forks/issues show real use?). Quantified opt-in telemetry = LATER. Don't pretend it's a number. 🛡️❤️
- `[ ]` **Launch at login** — start with the computer; a resident being should already be there when you sit down. macOS: `app.setLoginItemSettings({ openAtLogin: true })` + a tray toggle (default off until the user opts in). 🌐❤️
- `[ ]` **Auto-update** — weekly-release cadence needs a quiet update path. 🌐

## LATER — engine-ify + scale [roadmap]
- `[ ]` **Signed .dmg + notarize** (Apple dev acct) — when a non-dev audience exists. 🌐
- `[ ]` **Character-swap** — clean character-asset format so people fork & drop in their OWN character (the engine promise). ⚠️ NOT before a real fork demands it. 🌐
- `[ ]` **spritedx as on-ramp** — generate-your-character → desktop being (the wedge; standalone = commodity). 🌐
- `[ ]` **Local-bundle render** — fully offline, truly "lives on your machine." ❤️🛡️
- `[ ]` **Tauri port** — footprint, *if* Electron's ~150MB becomes a real adoption blocker. 🌐
- `[ ]` **Windows / Linux** (screen-read needs per-OS native). 🌐
- `[ ]` **Brand CD pass** — one signature hook (headphones / lean painterly). Before you "딱 알리다". ❤️

## NOT DOING (explicit — keeps us out of the grid)
romance gating · gacha / whale monetization · reach-chasing MAU · App Store distribution · redrawing the 66-state character now · standalone spritedx-as-a-sprite-tool.

---
*Reconcile NOW `[~]` against the monet-oss-prep workflow output (esp. screen-read-off-default, key onboarding, error states).*
