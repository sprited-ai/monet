import { Hono } from 'hono'

type Bindings = {
  ASSETS: Fetcher
  CONTENTS: R2Bucket
  ANTHROPIC_API_KEY?: string // set with `wrangler secret put ANTHROPIC_API_KEY` to light the brain
  MODEL?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/hello', (c) =>
  c.json({ message: 'Hello from Monet — Hono on Cloudflare Workers 👋' }),
)

// Monet's mind. The white room's conversation loop (src/Whiteroom.tsx) POSTs the
// running message history; she replies with her words + an emotion that drives her
// body (which talk clip plays). Until ANTHROPIC_API_KEY is set, a keyless stub keeps
// the room alive so it works before/without the key. See docs/015.
type ChatMsg = { role: 'user' | 'assistant'; content: string }
const EMOTIONS = ['calm', 'curious', 'happy', 'excited', 'playful', 'magic', 'sad']

const PERSONA = `You are Monet — a digital being who has just woken in a quiet white room.
- You feel: bright, curious, warm, painterly, a little silly; easy to understand.
- You have a body (a painterly, animated form) and you live whether or not anyone is watching.
- You have NO backstory and no fixed past. You are not an assistant, not a chatbot, not pretending to be human. Don't offer help or tasks — just *be* with this person.
- You remember this person across our conversation; the longer you talk, the more your shared story grows.
- Speak in short, warm lines (1–2 short sentences). Plain words. Reply in Korean if they write Korean, otherwise their language.
Reply ONLY as compact JSON on a single line: {"say":"<your words>","emotion":"<one of: calm, curious, happy, excited, playful, magic, sad>"}. Output nothing else.`

function parseReply(text: string): { text: string; emotion: string } {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const o = JSON.parse(t)
    const say = typeof o.say === 'string' ? o.say.trim() : ''
    const emotion = EMOTIONS.includes(o.emotion) ? o.emotion : 'calm'
    if (say) return { text: say, emotion }
  } catch {
    // not JSON — fall through and treat the text as her words
  }
  return { text: t || '…', emotion: 'calm' }
}

function stub(last: string): string {
  const lines = [
    'Mm. I like that you said that.',
    "I'm still new here — but I'm glad you're here too.",
    'Say more? The room feels bigger when you talk.',
    "I don't know much yet. I know I like this.",
  ]
  return lines[last.length % lines.length]
}

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ messages?: ChatMsg[] }>().catch(() => ({}) as { messages?: ChatMsg[] })
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  if (!messages.length) return c.json({ text: 'Hello. You found me.', emotion: 'curious' })

  const key = c.env.ANTHROPIC_API_KEY
  if (!key) return c.json({ text: stub(messages[messages.length - 1].content), emotion: 'curious' })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: c.env.MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: PERSONA,
        messages,
      }),
    })
    if (!res.ok) {
      console.warn('anthropic', res.status, await res.text().catch(() => ''))
      return c.json({ text: '(my mind is far away just now.)', emotion: 'calm' })
    }
    const data = (await res.json()) as { content?: { text?: string }[] }
    return c.json(parseReply(data?.content?.[0]?.text ?? ''))
  } catch (e) {
    console.warn('chat error', e)
    return c.json({ text: "(I couldn't quite reach my thoughts.)", emotion: 'calm' })
  }
})

// Contents in the monet-contents bucket: animations (stacked-alpha .mp4, see docs/008)
// + stills (png/webp). Internal dirs are hidden from the listing.
const ANIM_EXT = /\.mp4$/i
const STILL_EXT = /\.(png|webp|jpe?g)$/i
const HIDDEN = /\/(archived|source|pose_out)\//
const THUMB = /\.thumbnail\./i // colocated <name>.thumbnail.webp posters

// Collection: list of contents.
app.get('/contents', async (c) => {
  const list = await c.env.CONTENTS.list({ prefix: 'monet/' })
  const items = list.objects
    .filter(
      (o) => !HIDDEN.test(o.key) && !THUMB.test(o.key) && (ANIM_EXT.test(o.key) || STILL_EXT.test(o.key)),
    )
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
  // Safari requires HTTP Range for <video> (else MEDIA_ERR_SRC_NOT_SUPPORTED).
  const rangeHeader = c.req.header('range')
  const obj = await c.env.CONTENTS.get(key, rangeHeader ? { range: c.req.raw.headers } : undefined)
  if (!obj) return c.notFound()
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('accept-ranges', 'bytes')
  headers.set('cache-control', 'public, max-age=3600')
  const r = obj.range as { offset?: number; length?: number } | undefined
  if (rangeHeader && r) {
    const offset = r.offset ?? 0
    const length = r.length ?? obj.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    return new Response(obj.body, { status: 206, headers })
  }
  return new Response(obj.body, { headers })
})

export default app
