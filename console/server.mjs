// Monet Console — a thin web surface on top of the real `claude` CLI (Claude Code).
// Runs ON gin. Each chat turn spawns `claude -p` (headless, stream-json) with
// cwd = the monet repo, so Monetto runs with its real identity, memory, and tools,
// and streams to the browser over SSE. Pure Node (no npm deps — spawns the CLI).
// MVP: permissions bypassed (safety later). Expose via cloudflared.
//
//   node server.mjs        # http://localhost:8790  (on gin)
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const PORT = process.env.PORT || 8790
const CWD = process.env.MONET_CWD || '/home/gin/dev/monet'
const CLAUDE = process.env.CLAUDE_BIN || '/home/gin/.local/bin/claude'

const PAGE = /* html */ `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Monetto</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;background:#0b0b0f;color:#e9e9ee;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  #app{max-width:820px;margin:0 auto;height:100dvh;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #23232b}
  header b{font-weight:600}
  .dot{width:8px;height:8px;border-radius:50%;background:#3ad06a;box-shadow:0 0 8px #3ad06a}
  #log{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
  .row{display:flex}.row.me{justify-content:flex-end}
  .bub{max-width:82%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;word-break:break-word}
  .me .bub{background:#6d4aff;color:#fff;border-bottom-right-radius:4px}
  .ai .bub{background:#1b1b22;border:1px solid #2a2a33;border-bottom-left-radius:4px}
  .tool{font-size:12px;color:#8a8a99;padding:0 4px}.tool code{background:#1b1b22;padding:1px 6px;border-radius:5px;color:#b9a8ff}
  .empty{margin:auto;color:#6a6a78}
  form{display:flex;gap:8px;padding:14px 16px;border-top:1px solid #23232b}
  textarea{flex:1;resize:none;background:#15151b;color:#e9e9ee;border:1px solid #2a2a33;border-radius:12px;padding:10px 12px;font:inherit;max-height:140px}
  button{background:#6d4aff;color:#fff;border:0;border-radius:12px;padding:0 16px;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}
</style></head><body><div id="app">
<header><span style="font-size:18px">🎨</span><b>Monetto</b><span class="dot" title="claude code · gin"></span>
  <span style="margin-left:auto;font-size:12px;color:#7a7a88">claude code · gin</span></header>
<div id="log"><div class="empty">모네또랑 대화를 시작해봐.</div></div>
<form id="f"><textarea id="i" rows="1" placeholder="메시지… (Enter 전송, Shift+Enter 줄바꿈)"></textarea>
  <button id="s" type="submit">↑</button></form>
</div><script>
const log=document.getElementById('log'),i=document.getElementById('i'),f=document.getElementById('f'),s=document.getElementById('s')
let sessionId=null,busy=false
function row(cls){const r=document.createElement('div');r.className='row '+cls;const b=document.createElement('div');b.className='bub';r.appendChild(b);log.appendChild(r);log.scrollTop=log.scrollHeight;return b}
function tool(name){const d=document.createElement('div');d.className='tool';d.innerHTML='🔧 <code>'+name+'</code>';log.appendChild(d);log.scrollTop=log.scrollHeight}
i.addEventListener('input',()=>{i.style.height='auto';i.style.height=Math.min(i.scrollHeight,140)+'px'})
i.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();f.requestSubmit()}})
f.addEventListener('submit',async e=>{e.preventDefault();const text=i.value.trim();if(!text||busy)return
  const em=log.querySelector('.empty');if(em)em.remove()
  busy=true;s.disabled=true;i.value='';i.style.height='auto'
  row('me').textContent=text
  const out=row('ai');let acc=''
  try{
    const resp=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,sessionId})})
    const reader=resp.body.getReader(),dec=new TextDecoder();let buf=''
    for(;;){const{value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true})
      const parts=buf.split('\\n\\n');buf=parts.pop()
      for(const p of parts){const line=p.split('\\n').find(x=>x.startsWith('data:'));if(!line)continue
        const ev=JSON.parse(line.slice(5).trim())
        if(ev.type==='session')sessionId=ev.sessionId
        else if(ev.type==='text'){acc+=ev.delta;out.textContent=acc;log.scrollTop=log.scrollHeight}
        else if(ev.type==='tool')tool(ev.name)
        else if(ev.type==='error'){acc+='\\n⚠️ '+ev.message;out.textContent=acc}
      }}
  }catch(err){out.textContent=(acc||'')+'\\n⚠️ '+err}
  busy=false;s.disabled=false;i.focus()
})
</script></body></html>`

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
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
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
        connection: 'keep-alive',
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

server.listen(PORT, () => console.log(`🎨 Monet Console → http://localhost:${PORT}  cwd=${CWD}`))
