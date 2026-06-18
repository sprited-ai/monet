# Backlog

- [ ] Read "../anima/v34"
- [ ] Create v1 following "../anima/v34".

## v1 (White Room app)

- [x] Scaffold v1 hello-world: React 19 + Radix Themes 3.3.0 + Hono on Cloudflare
      Workers via `@cloudflare/vite-plugin` (mirrors `../sprite-dx/ui` setup). `/api/hello`
      Hono route + SPA. `pnpm dev` (port 8788) / `pnpm build` / `pnpm deploy`. Verified
      end-to-end in browser. Stack validated against current Cloudflare best practice (2026).
- [x] Adopt repo conventions: `v*` disposable-island prototypes + shared root assets;
      **pnpm project-wide** (no workspace — islands stay independent, store dedupes disk).
      tsconfigs under `v1/conf/`. Documented in `docs/007-repo-structure.md`.
- [x] CI/CD: push to `main` → GitHub Actions builds & deploys each changed `v*` to
      `monet-v*.sprited.ai` (custom_domain route per worker). Config + workflow in repo;
      config validated via `wrangler deploy --dry-run`. See `docs/007-repo-structure.md`.
- [x] CI secrets in place + first deploy live: **monet-v1.sprited.ai** (custom domain provisioned,
      API + SPA verified in prod). Workflow simplified to one file per version (`deploy-v1.yml`).
- [x] Assets → R2: `contents/` mirrors to bucket `monet-contents` (sync-contents.yml, incremental
      via in-bucket manifest). Backfilled 90 objects.
- [x] `/editor` — previews all contents (animations + stills) with filter; hover to play. Worker
      exposes a single `/contents` resource (list + `/contents/<key>` stream). **Dev pulls from
      local `contents/` via a Vite middleware (R2 bypassed); prod serves from R2.** `worker/` → `api/`.
- [x] **Video-rendering decision (docs/008):** Pixi (canvas/WebGL) + **stacked-alpha H.264**
      (color top / alpha-as-luma bottom, shader composites). Proven transparent + animating in
      **Chrome AND Safari** (autoplay gesture-gated = on-narrative "click to come alive"); stacked
      979 KB < source webm 1.8 MB. webm stays the R2 source; stacked is a CI-derived delivery.
      POC: `experiments/stacked-alpha-poc/`.
- [x] **Transform all → stacked .mp4 delivery:** 64 clips webm→stacked-H.264 (41 MB vs 96 MB);
      originals backed up to `contents/monet/source/` (gitignored). Colocated `<name>.thumbnail.webp`
      (native size, q90) for the grid; `WebGL StackedVideo` composite on hover. Editor draws an
      origin crosshair. Pipeline (worker/middleware/measure/sync) switched .webm→.mp4; sync honors
      `.gitignore`. Internal dirs `source|pose_out|archived` + `*.thumbnail.*` hidden from `/contents`.
- [ ] **Editor: keyframe thumbnail picker** (later) — scrub a clip, pick the frame, save it as
      `<name>.thumbnail.webp` (native size, so it just swaps which frame). Local-generated for now.
- [ ] **Sidecar `<name>.json`** (not started) — hand-authored loop {in,out}, name, kind, tags.
      Comes with the trim UI; the player reads it for loop-segment playback.
- [ ] Build: **stacked-H.264 derivative CI** — push `contents/**` source → ubuntu (ffmpeg w/ libvpx)
      decode VP9 alpha → vstack → x264 + thumbnail → R2, changed-files-only. (now done locally.)
- [ ] Build: **Pixi player** — stacked-alpha shader, sprite anchored at `origin`, loop in/out
      (trim), gesture-to-play. Powers both `/editor` (per-clip trim UI) and the White Room.
- [ ] Metadata: wire `/contents` to serve `index.json` (origin/framing/loop). Editor already reads
      `index.json` + `framings.json` directly for the origin crosshair.
- [ ] Assets domain when needed for public/CDN: `monet-assets.sprited.ai` → monet-contents
      (per-project subdomain; keep `assets.sprited.ai` free for a future router).
- [ ] Build the opening "encounter" sequence (white room → canvas → Renoir taps → Monet emerges).
- [ ] Wire animation playback from R2; idle loop + state transitions.

## Experiments

- [x] Get `bizarre-pose-estimator` running locally (native arm64, CPU) — anime/illustration
      pose estimator. Working on repo-root `.venv`. See
      `experiments/bizarre-pose-estimator/RUN_NOTES.md` for the recipe (detectron2 source build,
      `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1`, numpy-2 patch, new GDrive file ID). Excluded from git.
- [ ] (maybe) Use bizarre-pose-estimator to extract COCO keypoints from Monet animation frames —
      could feed pose-conditioned generation / consistency checks for the v1 animation pipeline.
