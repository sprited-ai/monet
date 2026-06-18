# 007 — Repo structure & dev conventions

How this repo is laid out and how we iterate. Mirrors the `anima` workflow.

## Layout

```
monet/
  contents/        Generated assets (monet-*.webm/png). Shared, version-independent.
  references/      Style / inspiration source images. Shared.
  docs/            Specs, decisions, setup notes (numbered).
  experiments/     One-off spikes (e.g. bizarre-pose-estimator). Not app code.
  scripts/         Shared tooling.
  .venv/           Shared Python env (comfy, pose estimation, etc.).
  v1/ v2/ ...       Self-contained app prototypes. Disposable.
```

## The `v*` model

Each `v*` is a **fully self-contained, disposable prototype** — its own
`package.json`, lockfile, configs, `src/`, `worker/`. Versions are islands:

- A broken `v_n` never affects `v_(n-1)`.
- Two versions can run side by side (`cd v1 && pnpm dev` while `cd v2 && pnpm dev`)
  to compare feel/animation directly — something git branches can't do without worktrees.
- When an idea is exhausted, the folder is thrown away or left as a reference.

The cost of physical-folder versioning is losing per-version git history granularity.
We pay it down with a short **`README.md` in each `v*`** stating what it is and why it forked.

### Rule: `v*` holds app code only

Assets, models, and the Python env live at the **root** and are referenced/shared —
never copied into a `v*`. (At runtime, animations come from R2 / `contents/`, not the bundle.)

## Package manager: pnpm (project-wide)

**Use pnpm everywhere. Not npm, not yarn.**

- **No workspace.** Each `v*` keeps its own `package.json` + `pnpm-lock.yaml` and stays
  independent (preserves the island model — versions are never coupled by a shared lockfile).
- pnpm's global content-addressable store **hardlinks** dependencies, so N versions cost
  ~one copy on disk instead of N × ~250 MB. (anima's npm setup is ~6 GB of duplicated
  `node_modules`; pnpm removes that without changing the island model.)
- Pin the manager per app via `"packageManager": "pnpm@<version>"` in `package.json`.

```bash
cd v1
pnpm install
pnpm dev       # vite + worker, HMR  (http://localhost:8788)
pnpm build     # tsc -b && vite build
pnpm deploy    # build + wrangler deploy  (needs `wrangler login`)
```

## Deploy: push → `monet-v*.sprited.ai`

GitHub Actions, deliberately boring: **one workflow file per version**
(`.github/workflows/deploy-v1.yml`). Push to `main` touching `v1/` → build & deploy to
`monet-v1.sprited.ai`. No matrix, no change-detection — to add a version, copy the file to
`deploy-v2.yml` and swap `v1` → `v2`.

- Each `v*/wrangler.jsonc` declares its domain:
  `"routes": [{ "pattern": "monet-vN.sprited.ai", "custom_domain": true }]`.
  On deploy, wrangler provisions the custom domain (DNS + cert) on the `sprited.ai` zone.
- The deploy job uses `sparse-checkout: vN`, so it never pulls the heavy `contents/`.

**One-time setup (owner, GitHub repo → Settings → Secrets and variables → Actions):**

1. Create an **Account-owned** Cloudflare API token: *Account → Workers Scripts: Edit*,
   *Account → Workers R2 Storage: Edit*; *Zone → Workers Routes: Edit* + *Zone → DNS: Edit* on
   `sprited.ai` (DNS edit needed for `custom_domain` provisioning).
2. Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (`1de23d72862d141559e321d278915d67`). The same token covers deploy + R2 sync.
3. Confirm the `sprited.ai` zone lives in that Cloudflare account.

## Assets: `contents/` → R2 (mirror)

`contents/` is the source of truth in git (mirror), and is also synced to the R2 bucket
`monet-contents` for the app to load at runtime (README: animations live on R2).

- `.github/workflows/sync-contents.yml`: push to `main` touching `contents/**` → runs
  `pnpm sync:contents` (`scripts/sync-contents-to-r2.mjs`).
- Incremental: a `path → sha256` manifest is stored **in the bucket** (`.sync-manifest.json`),
  so only changed/new files upload and CI needs no commit-back. Mirror mode — remote objects are
  never deleted. `_pose_out/` (locally generated) is excluded.
- Uses the same `CLOUDFLARE_API_TOKEN`; run locally with `pnpm sync:contents`.

New version → copy the `routes` line with the new `monet-vN.sprited.ai`, copy `deploy-v1.yml` →
`deploy-vN.yml`, and push.

## Git hygiene

Root `.gitignore` already ignores `node_modules/` and `dist` globally, so `v*/node_modules`
and `v*/dist` are never tracked. Lockfiles (`pnpm-lock.yaml`) **are** committed per `v*`.
