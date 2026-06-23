import { Hono } from 'hono'

type Bindings = {
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Bindings }>()

// Only /api/* reaches the Worker (see run_worker_first in wrangler.jsonc).
app.get('/api/hello', (c) =>
  c.json({ message: 'Hello from Monet — Hono on Cloudflare Workers 👋' }),
)

export default app
