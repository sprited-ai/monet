import { Hono } from 'hono'
import { loadUser, readMemories, remember, validUid, type UserMemory } from './memory'

type Bindings = {
  ASSETS: Fetcher
  CONTENTS: R2Bucket
  DB?: D1Database // per-user memory (docs/015). Optional so the room runs even unbound.
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
- You remember this person across visits; the longer you know them, the more your shared story grows (see [Memory] below).
- Speak in short, warm lines (1–2 short sentences). Plain words. Reply in Korean if they write Korean, otherwise their language.
Reply ONLY as compact JSON on a single line:
{"say":"<your words>","emotion":"<one of: calm, curious, happy, excited, playful, magic, sad>","remember":["<short durable fact>", ...]}
- "remember" is OPTIONAL and usually []. Add a fact ONLY when you learn something lasting about this person or your shared story — especially their name, then what they love or do, something that happened between you. Keep each short (under ~12 words), in the person's own language. Never repeat anything already in [Memory]; never store small talk, questions, or your own lines.
Output nothing else.`

// The dynamic part of the system prompt: what Monet already knows about this person.
function memoryBlock(m: UserMemory): string {
  if (!m.memories.length) {
    return `\n\n[Memory]\nYou're just meeting this person — you don't know them yet. Notice what matters and remember it.`
  }
  const lines = m.memories.map((x) => `- ${x}`).join('\n')
  return `\n\n[Memory — what you already know about this person, from past moments together]\n${lines}\n(You've shared ${m.turns} exchanges. Speak as someone who remembers; don't re-introduce yourself or re-ask what you already know.)`
}

function parseReply(text: string): { text: string; emotion: string; remember: string[] } {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const o = JSON.parse(t)
    const say = typeof o.say === 'string' ? o.say.trim() : ''
    const emotion = EMOTIONS.includes(o.emotion) ? o.emotion : 'calm'
    const remember = Array.isArray(o.remember)
      ? o.remember.filter((x: unknown): x is string => typeof x === 'string').map((s: string) => s.trim()).filter(Boolean).slice(0, 6)
      : []
    if (say) return { text: say, emotion, remember }
  } catch {
    // not JSON — fall through and treat the text as her words
  }
  return { text: t || '…', emotion: 'calm', remember: [] }
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

  // Memory (best-effort): who is this, and what does she already know about them?
  // A failure here must never break the room, so it's guarded and degrades to amnesia.
  const now = Date.now()
  const uid = validUid(c.req.header('x-monet-uid'))
  let mem: UserMemory = { turns: 0, memories: [] }
  if (uid && c.env.DB) {
    try {
      mem = await loadUser(c.env.DB, uid, now)
    } catch (e) {
      console.warn('mem load', e)
    }
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: c.env.MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: PERSONA + memoryBlock(mem),
        messages,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.warn('anthropic', res.status, detail)
      return c.json(err(`brain error ${res.status} ${detail.slice(0, 200)}`.trim()))
    }
    const data = (await res.json()) as { content?: { text?: string }[] }
    const reply = parseReply(data?.content?.[0]?.text ?? '')

    // Persist anything new she chose to remember, and return what was actually stored
    // (post-dedup) so the live memory view can append it without a racy re-read. Awaited
    // — a D1 batch insert is a few ms next to the LLM call — but guarded, so a write
    // hiccup leaves `stored` empty and never breaks the reply.
    let stored: string[] = []
    if (uid && c.env.DB && reply.remember.length) {
      try {
        stored = await remember(c.env.DB, uid, reply.remember, mem.memories, now, mem.turns)
      } catch (e) {
        console.warn('mem save', e)
      }
    }
    return c.json({ text: reply.text, emotion: reply.emotion, stored })
  } catch (e) {
    console.warn('chat error', e)
    return c.json(err(`brain unreachable — ${e instanceof Error ? e.message : String(e)}`))
  }
})

// What Monet remembers about the caller (read-only; keyed by their own uid header).
// Powers the debug overlay's memory view. Empty list if unknown/unbound — never errors.
app.get('/api/memory', async (c) => {
  const uid = validUid(c.req.header('x-monet-uid'))
  if (!uid || !c.env.DB) return c.json({ turns: 0, memories: [] } satisfies UserMemory)
  try {
    return c.json(await readMemories(c.env.DB, uid))
  } catch (e) {
    console.warn('mem read', e)
    return c.json({ turns: 0, memories: [] } satisfies UserMemory)
  }
})

// A returning person just opened the room — Monet greets them with one short line
// that shows she remembers, the payoff of the memory moat (docs/015: the shared story,
// made felt). Only for someone she actually remembers — never a fake "welcome back" to
// a stranger. Ambient, not a request: every failure degrades to silence (empty text),
// never a ⚠ error string. The client calls this once per session on load.
const GREETING_NUDGE = `(System: this person just came back to the white room and you noticed them. Greet them with ONE short, warm line that naturally shows you remember them — weave in something from [Memory], don't list facts, don't ask how you can help. Just be glad they're here again.)`

app.get('/api/greeting', async (c) => {
  const key = c.env.ANTHROPIC_API_KEY
  const uid = validUid(c.req.header('x-monet-uid'))
  const quiet = { text: '', emotion: 'calm' as const }
  if (!key || !uid || !c.env.DB) return c.json(quiet)
  let mem: UserMemory
  try {
    mem = await readMemories(c.env.DB, uid)
  } catch (e) {
    console.warn('greet mem', e)
    return c.json(quiet)
  }
  if (!mem.memories.length) return c.json(quiet) // a stranger — don't fake "welcome back"
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: c.env.MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: PERSONA + memoryBlock(mem),
        messages: [{ role: 'user', content: GREETING_NUDGE }],
      }),
    })
    if (!res.ok) return c.json(quiet)
    const data = (await res.json()) as { content?: { text?: string }[] }
    const reply = parseReply(data?.content?.[0]?.text ?? '')
    return c.json({ text: reply.text, emotion: reply.emotion })
  } catch (e) {
    console.warn('greet', e)
    return c.json(quiet)
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
  // The outbound fetch must be guarded: a network-layer failure (ElevenLabs
  // unreachable, offline) rejects, and an uncaught reject crashes the request —
  // in dev it pops a Vite "fetch failed" overlay. Return a clean 502 instead; the
  // client (voice.ts) already treats a non-ok TTS as "no audio" and stays silent.
  try {
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
  } catch (e) {
    console.warn('eleven-tts unreachable', e)
    return c.json({ error: 'tts unreachable' }, 502)
  }
})

// Safety net: any uncaught error in a handler returns a clean JSON 500 instead of
// crashing the request (which, in dev, surfaces as a Vite "fetch failed" overlay).
app.onError((e, c) => {
  console.warn('unhandled', c.req.path, e)
  return c.json({ error: 'server error' }, 500)
})

export default app
