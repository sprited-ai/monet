# Backlog

> **Re-scoped 2026-06-23 → `docs/015-re-requirements.md`.** The project is now ONLY the **Whiteroom**:
> Monet as a *living being* (not a companion) in a white room at `monet.sprited.ai` — clean-slate
> character that writes a story *with* the user; first-5-seconds-convincing; cozy; comeback-worthy.
> **Out of scope (archived → `archived/`):** Instagram posts, social video generation, the "Monet's
> Garden" game concept, marketing/GTM, the local-homelab video-gen pipeline. **Target: whiteroom +
> billing live by ~July 20.**

## Whiteroom (active — the only focus)

- [ ] **Whiteroom setup** — Monet (sprite character) alive in a white room at `monet.sprited.ai`.
      Goal: *convince in the first 5 seconds*; already-good the moment you land; cozy (cf. lunamachi).
- [ ] **Core-loop proof** — is it come-back-worthy? fun? gives dopamine / emergent / addictive?
      (Provable without daily IG — just needs to feel alive to Jin first.)
- [ ] **Living-being model** — *not a companion, a living being, and the user's OWN.* Clean slate:
      has knowledge·wisdom·embodiment but **no backstory of its own**; from blank, it interacts and
      *writes a story together* with the user. Per-user memory = the bond/moat (buy-first: Honcho/Mem0).
- [ ] **Auth** — Anonymous login (OpenAI style) + real Login.
- [ ] **GDPR / Privacy / Trust & Safety.**
- [ ] **Admin website** (monet-console may serve this — see Live infra).
- [ ] **Sprite eye-control limitation** — sprites can't move eyes independently. Fix: brute-force sprite
      edits, OR send to image-2 / nano-banana-pro for per-direction states + separated eyes (enough to read as alive).
- [ ] **Billing** — add before the July-20 target.

## Foundation (done — the whiteroom rendering stack stays)

- [x] v1 app scaffold (React 19 + Radix + Hono on CF Workers); repo conventions (`docs/007`); CI/CD to
      `monet-v*.sprited.ai`; first deploy live (**monet-v1.sprited.ai**).
- [x] Assets → R2 (`contents/` → `monet-contents`, incremental sync).
- [x] **Stacked-alpha H.264 rendering** (color/alpha-as-luma, WebGL shader; Chrome+Safari) — `docs/008`.
      64 clips transcoded; thumbnails; `WebGL StackedVideo`. **This is the whiteroom rendering core.**
- [x] `/editor` (preview all contents, origin crosshair) + `/preview` + deterministic screenshot tests.
- [x] `/studio` toy-play prototype (animated Monet on canvas + continuity/localStorage greeting) —
      a first whiteroom-ish prototype (`v1/src/Studio.tsx`). Note: its record/IG bits are out-of-scope now.

## Render TODOs (whiteroom-relevant — kept)

- [ ] **Pixi player** — stacked-alpha shader, sprite anchored at `origin`, loop in/out (trim), gesture-to-play.
      Powers the whiteroom (and `/editor` trim UI).
- [ ] Metadata: wire `/contents` to serve `index.json` (origin/framing/loop).
- [ ] Opening **encounter** sequence (white room → canvas → Monet emerges).
- [ ] Idle loop + animation-state transitions from R2.
- [ ] **Re-render `monet-jump-large-3`** — baked-in source flicker (new seed or drop).
- [ ] `monet-assets.sprited.ai` CDN subdomain when public delivery is needed.

## Live infra (kept — do not archive)

- **monet-v1.sprited.ai** (v1 app). **monet-console.sprited.ai** + **monet-agent** (gin systemd) —
  Monetto = raw `claude` CLI behind CF Access (Jin-only), SSE chat, session-persisted. Kept as the
  **admin/dev surface** (docs/015 lists "Admin website" in scope). Its leftover comfy/ollama/video-gen
  proxy code is now out-of-scope cruft (harmless; trim later).

## Archived 2026-06-23 (out-of-scope per docs/015 → `archived/`)

- IG video-gen: `scripts/{seedance,ig_text,ig-videos}.{py,sh}`, `docs/013-ig-videos.md`.
- Local-homelab gen: `workflows/` (LTX/Wan), `scripts/ui2api.py`.
- Historical / IG / garden docs: `docs/001–006`, `009`, `010`, `011-story-bites`.
- ⏳ **Pending Jin's call (untracked, not moved):** `ig/`, `experiments/comfy-mcp/`, `experiments/v0-template/`,
  `docs/011-monets-garden-story.md`, `docs/012-jin-story.md`, `docs/014-monet-live-puppet.md`,
  `docs/014-monetto-design.md`, `references/`, `.env.example` reconcile, `v1/README.md` reconcile.

## Experiments (status unclear — Jin to decide)

- [x] `bizarre-pose-estimator` running locally (anime pose keypoints; could check anim consistency).
- [ ] `rhythm-cast-proto` — throwaway; verdict pending (likely out-of-scope now).
