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
- [ ] `/editor` next: per-clip trim UI — scrubber + in/out markers for loop-segment identification,
      export segments.
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
