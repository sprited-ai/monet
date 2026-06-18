import { Hono } from 'hono'

type Bindings = {
  ASSETS: Fetcher
  CONTENTS: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/hello', (c) =>
  c.json({ message: 'Hello from Monet — Hono on Cloudflare Workers 👋' }),
)

// List contents mirrored to the monet-contents bucket: animations (webm) + stills (png/webp/jpg).
const ANIM_EXT = /\.webm$/i
const STILL_EXT = /\.(png|webp|jpe?g)$/i

// Collection: list of contents.
app.get('/contents', async (c) => {
  const list = await c.env.CONTENTS.list({ prefix: 'monet/' })
  const items = list.objects
    .filter((o) => ANIM_EXT.test(o.key) || STILL_EXT.test(o.key))
    .map((o) => ({
      key: o.key,
      name: o.key.replace(/^monet\//, '').replace(/\.[^.]+$/, ''),
      size: o.size,
      type: ANIM_EXT.test(o.key) ? ('animation' as const) : ('still' as const),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return c.json({ items })
})

// Item: stream an object straight from R2. (Off /assets/* so it never shadows
// Vite's own client bundle, which is served from /assets/.) In local dev these
// /contents routes are intercepted by a Vite middleware that reads contents/ off
// disk, so the Worker (and R2) is bypassed entirely — see vite.config.ts.
app.get('/contents/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/contents\//, ''))
  const obj = await c.env.CONTENTS.get(key)
  if (!obj) return c.notFound()
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=3600')
  return new Response(obj.body, { headers })
})

export default app
