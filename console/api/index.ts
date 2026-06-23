import { Hono, type Context } from 'hono'

type Bindings = {
  ASSETS: Fetcher
  CONTENTS: R2Bucket // monet-contents — generated videos live here
  AGENT_BASE_URL: string // gin claude-bridge tunnel, e.g. https://agent.monet.sprited.ai
  // One Cloudflare Access service token guards the gin tunnels (already in .env.local).
  CF_ACCESS_CLIENT_ID: string
  CF_ACCESS_CLIENT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

// --- /api/chat → gin claude-bridge (SSE) ----------------------------------------
// The Worker is the Jin-only front door (CF Access). The brain is `claude` running
// on gin; this proxies the chat stream through, attaching the Access service token
// so the browser never holds it. Response is streamed straight back (SSE).
function accessHeaders(env: Bindings): Record<string, string> {
  return {
    'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID ?? '',
    'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET ?? '',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) monet-console/0.1',
  }
}

async function proxyAgent(c: Context<{ Bindings: Bindings }>, path: string) {
  const base = c.env.AGENT_BASE_URL?.replace(/\/$/, '')
  if (!base) return c.json({ error: 'AGENT_BASE_URL not set' }, 500)
  if (!c.env.CF_ACCESS_CLIENT_ID || !c.env.CF_ACCESS_CLIENT_SECRET)
    return c.json({ error: 'service token not set (wrangler secret put CF_ACCESS_CLIENT_ID/SECRET)' }, 503)
  const init: RequestInit = { method: c.req.method, headers: { ...accessHeaders(c.env) } }
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.headers = { ...(init.headers as object), 'content-type': c.req.header('content-type') ?? 'application/json' }
    init.body = c.req.raw.body
    // @ts-expect-error - streaming request body on Workers
    init.duplex = 'half'
  }
  const resp = await fetch(`${base}${path}`, init)
  const headers = new Headers(resp.headers)
  headers.delete('content-encoding')
  headers.set('cache-control', 'no-cache')
  return new Response(resp.body, { status: resp.status, headers })
}

app.all('/api/chat', (c) => proxyAgent(c, '/api/chat'))
app.all('/api/agent/*', (c) => proxyAgent(c, c.req.path.replace(/^\/api\/agent/, '')))

// --- generated videos from R2 (Range-aware, for <video>) ------------------------
app.get('/contents/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/contents\//, ''))
  const range = c.req.header('range')
  const obj = await c.env.CONTENTS.get(key, range ? { range: c.req.raw.headers } : undefined)
  if (!obj) return c.notFound()
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('accept-ranges', 'bytes')
  const r = obj.range as { offset?: number; length?: number } | undefined
  if (range && r) {
    const offset = r.offset ?? 0
    const length = r.length ?? obj.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    return new Response(obj.body, { status: 206, headers })
  }
  return new Response(obj.body, { headers })
})

export default app
