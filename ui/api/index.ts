import { Hono } from 'hono'

type Bindings = {
  ASSETS: Fetcher
  CONTENTS: R2Bucket
  ANTHROPIC_API_KEY?: string // set with `wrangler secret put ANTHROPIC_API_KEY` to light the brain
  ELEVENLABS_API_KEY?: string // her voice (TTS); only called when the user un-mutes
  ELEVENLABS_TTS_MODEL?: string
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

// Failures surface as a transparent ⚠ error string (not a fake in-character line),
// so it's obvious the brain is offline/erroring rather than "Monet being weird".
const err = (text: string) => ({ text: `⚠ ${text}`, emotion: 'calm' as const })

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ messages?: ChatMsg[] }>().catch(() => ({}) as { messages?: ChatMsg[] })
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  if (!messages.length) return c.json(err('no message'))

  const key = c.env.ANTHROPIC_API_KEY
  if (!key) return c.json(err('brain offline — ANTHROPIC_API_KEY not set'))

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
      const detail = await res.text().catch(() => '')
      console.warn('anthropic', res.status, detail)
      return c.json(err(`brain error ${res.status} ${detail.slice(0, 200)}`.trim()))
    }
    const data = (await res.json()) as { content?: { text?: string }[] }
    return c.json(parseReply(data?.content?.[0]?.text ?? ''))
  } catch (e) {
    console.warn('chat error', e)
    return c.json(err(`brain unreachable — ${e instanceof Error ? e.message : String(e)}`))
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

// Her voice. POST /api/tts { text } → ElevenLabs mp3. Called by the white room only
// when the user has un-muted (so it doesn't autoplay or burn credits silently).
// Per-language voice — a single voice carries its accent, so off-language sounds wrong.
const VOICE_KO = 'n2fbxG88jqAoaVPUy3IG' // Yooni — Seoul native
const VOICE_EN = 'uYXf8XasLslADfZ2MB4u' // Hope — bright, girly, English-native
const VOICE_JA = 'ozfS3gQtjFX3kQyJ12dX' // Saori — warm, Japanese-native
const isKorean = (s: string) => /[㄰-㆏가-힣]/.test(s)
const isJapanese = (s: string) => /[぀-ヿ]/.test(s)

app.post('/api/tts', async (c) => {
  const body = await c.req.json<{ text?: string }>().catch(() => ({}) as { text?: string })
  const text = (body.text || '').trim().slice(0, 600)
  if (!text) return c.json({ error: 'no text' }, 400)
  const key = c.env.ELEVENLABS_API_KEY
  if (!key) return c.json({ error: 'no ELEVENLABS_API_KEY' }, 503)
  const voiceId = isKorean(text) ? VOICE_KO : isJapanese(text) ? VOICE_JA : VOICE_EN
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key, accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: c.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
      voice_settings: { stability: 0.32, similarity_boost: 0.7, style: 0.55, use_speaker_boost: true },
    }),
  })
  if (!r.ok) {
    console.warn('eleven-tts', r.status, await r.text().catch(() => ''))
    return c.json({ error: `tts ${r.status}` }, 502)
  }
  return new Response(r.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } })
})

export default app
