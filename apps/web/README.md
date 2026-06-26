# @monet/web — Monet's body

The whiteroom: Monet's render + brain, served at **monet.sprited.ai**. A React 19 app
(Radix Themes, WebCodecs-driven animation playback) fronting a Hono Worker on Cloudflare.
The desktop being (`apps/desktop`) loads the **`/desktop`** route from here in transparent
overlay mode — same room, dissolved to a click-through silhouette on the real desktop.

Routes: `/` (the white room), `/desktop` (overlay), `/editor`, `/preview`, `/mouth` (lip-sync lab).

## Dev

```bash
npm run dev -w @monet/web   # Vite + the Hono worker → http://localhost:1874
npm run build  -w @monet/web   # tsc -b && vite build
npm run deploy -w @monet/web   # build + wrangler deploy (push to main auto-deploys)
```

Dev port is **1874** (override with `MONET_PORT`). `/api/*` and `/contents/*` hit the
Hono Worker (`api/index.ts`); everything else is the SPA. tsconfigs live in `conf/`.

### Config

- **Secrets** — copy `.dev.vars.example` → `.dev.vars`: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `ELEVENLABS_API_KEY`, `GROQ_API_KEY`. In prod, set these as Worker secrets (`wrangler secret put`).
- **Bindings** (`wrangler.jsonc`): `DB` → D1 `monet-memory` (per-user memory, schema in `migrations/`);
  `CONTENTS` → R2 `monet-contents` (animations + stills). In local dev, Vite serves `contents/`
  off disk instead of R2.
