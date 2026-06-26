// monet-agent — the gin-side brain for Monet Console.
// A thin bridge on top of the real `claude` CLI: each chat turn spawns
// `claude -p` (headless, stream-json) with cwd = the monet repo, so Monetto runs
// with its real identity, memory, and tools, and streams back over SSE.
//
// Runs on gin as systemd `monet-agent`, exposed at monet-agent.sprited.ai (CF Access
// service token). The UI/front door is the separate Cloudflare Worker (console/).
// Pure Node — no npm deps. MVP: permissions bypassed (safety later).
//
//   node agent/monet-agent.mjs      # http://localhost:8790
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const PORT = process.env.PORT || 8790
const CWD = process.env.MONET_CWD || '/home/gin/dev/monet'
const CLAUDE = process.env.CLAUDE_BIN || '/home/gin/.local/bin/claude'

function sse(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
}

function runClaude(res, message, sessionId) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', 'bypassPermissions',
  ]
  if (sessionId) args.push('--resume', sessionId)

  const child = spawn(CLAUDE, args, { cwd: CWD, env: { ...process.env } })
  child.stdin.write(message)
  child.stdin.end()

  let streamedText = false
  let buf = ''
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      let j
      try {
        j = JSON.parse(t)
      } catch {
        continue
      }
      if (j.type === 'system' && j.subtype === 'init' && j.session_id) {
        sse(res, 'session', { sessionId: j.session_id })
      } else if (j.type === 'stream_event') {
        const ev = j.event
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          streamedText = true
          sse(res, 'text', { delta: ev.delta.text })
        }
      } else if (j.type === 'assistant') {
        for (const b of j.message?.content ?? []) {
          if (b.type === 'tool_use') sse(res, 'tool', { name: b.name })
        }
      } else if (j.type === 'result') {
        if (!streamedText && typeof j.result === 'string') sse(res, 'text', { delta: j.result })
        if (j.session_id) sse(res, 'session', { sessionId: j.session_id })
        sse(res, 'done', {})
      }
    }
  })
  let err = ''
  child.stderr.on('data', (c) => (err += c.toString()))
  child.on('close', (code) => {
    if (code !== 0 && !streamedText) sse(res, 'error', { message: `claude exited ${code}: ${err.slice(0, 400)}` })
    res.end()
  })
}

const server = createServer((req, res) => {
  // health / sanity
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'monet-agent', cwd: CWD }))
    return
  }
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let message = '',
        sessionId
      try {
        ;({ message, sessionId } = JSON.parse(body || '{}'))
      } catch {}
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      })
      if (!message) {
        sse(res, 'error', { message: 'empty message' })
        return res.end()
      }
      runClaude(res, message, sessionId)
    })
    return
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, () => console.log(`monet-agent → http://localhost:${PORT}  cwd=${CWD}`))
