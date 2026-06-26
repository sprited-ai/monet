// Preload — runs in the page (shares its world; contextIsolation is off in main.js), bridges
// Monet's render to the native window.
//
// Jobs:
//  1) Silhouette click-through. The window is click-through by default; whenever the cursor is over
//     Monet's actual pixels (alpha > threshold, from window.__monetAlphaAt that the app exposes in
//     overlay mode) we flip the window interactive so the press lands on her — then back to
//     click-through the moment the cursor leaves. She's solid; the air around her isn't.
//  2) Press semantics on her body:
//       • press + release in place  → a click → falls through to the app (toggle listening, mic on)
//       • press + drag              → move the whole window (and swallow the trailing click)
//       • right-click               → context menu (Reload / Hide / Quit)

const { ipcRenderer } = require('electron')

// --- BYOK brain seam --------------------------------------------------------------------
// contextIsolation is OFF (main.js), so the preload shares the page's `window` and can
// reroute the hosted app's chat fetch to the user's OWN Anthropic key. The request never
// leaves this Mac except to api.anthropic.com; the key lives only in the main process and
// is never put on `window` (the hosted page could read it). No web-app change needed —
// Whiteroom.tsx calls global `fetch('/api/chat', { body: JSON.stringify(...) })` per send,
// and the preload runs before page scripts, so this reassignment is the one that's live.
//
// Non-streaming: Whiteroom does `await r.json()` (one JSON object), so we hand back a single
// synthetic Response — no SSE/ReadableStream rebuild. If /api/chat ever moves to streaming
// upstream, this breaks loudly (the page would get a non-JSON body) — see README BYOK note.
//
// If contextIsolation is ever turned on for hardening, this window.fetch patch stops working;
// the fallback is an additive `window.monet.chat` contextBridge shim + a tiny ui/ branch.
const _fetch = window.fetch.bind(window)
const _matches = (u, re) => re.test(u)
const _json = (data) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
window.fetch = function (input, init) {
  try {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
    // Catch the page's chat POST and reroute its (string) body to main via IPC. Only a
    // string body + POST is intercepted; a Request-object/non-string body falls through to
    // the real network so we degrade to the hosted origin rather than dropping the call.
    if (_matches(url, /\/api\/chat(?:\?|$)/) && method === 'POST' && init && typeof init.body === 'string') {
      return ipcRenderer.invoke('monet:byok-chat', { body: init.body }).then(_json)
    }
    // No D1 in the OSS shell → answer greeting/memory locally so no per-user id (x-monet-uid)
    // ever reaches the hosted origin. The hosted endpoints would return these empties for an
    // unknown uid anyway, so behaviour is unchanged — just kept off the network.
    if (_matches(url, /\/api\/greeting(?:\?|$)/)) return Promise.resolve(_json({ text: '', emotion: 'calm' }))
    if (_matches(url, /\/api\/memory(?:\?|$)/)) return Promise.resolve(_json({ turns: 0, memories: [] }))
  } catch {
    /* anything unexpected → fall through to the real network, never break the page */
  }
  // Everything else (assets, /contents, /api/tts, /api/whisper) hits the hosted origin as-is.
  return _fetch(input, init)
}
// ----------------------------------------------------------------------------------------

const ALPHA_THRESHOLD = 0.1 // a pixel counts as "her" above this coverage
const DRAG_THRESHOLD = 4 // px of motion before a press is treated as a drag, not a click

let interactive = false
let pressed = false // left button down on her, click-vs-drag not yet decided
let dragging = false // moved past threshold → relocating the window
let suppressClick = false // a drag just ended → swallow the trailing click (don't toggle listening)
let grabX = 0 // cursor offset inside the window at press = its client coords
let grabY = 0

function setInteractive(next) {
  if (next === interactive) return
  interactive = next
  ipcRenderer.send('monet:set-interactive', next)
}

function onHer(clientX, clientY) {
  const f = window.__monetAlphaAt
  return !!f && f(clientX, clientY) > ALPHA_THRESHOLD
}

// On-demand screen read for the app's brain wiring (Stage 2): returns { ok, text } | { ok:false, error }.
// Local + on-demand — nothing fires until the app calls this.
window.__monetReadScreen = () => ipcRenderer.invoke('monet:read-screen')

window.addEventListener(
  'mousemove',
  (e) => {
    if (pressed) {
      if (!dragging && Math.hypot(e.clientX - grabX, e.clientY - grabY) > DRAG_THRESHOLD) dragging = true
      if (dragging) {
        // e.screenX/Y are global; subtract the grabbed in-window offset → new window top-left.
        ipcRenderer.send('monet:drag', { x: e.screenX - grabX, y: e.screenY - grabY })
        return
      }
    }
    setInteractive(onHer(e.clientX, e.clientY))
  },
  true,
)

// Cursor left the window entirely (and we're not mid-press) → drop back to click-through.
window.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget && !pressed) setInteractive(false)
}, true)

window.addEventListener(
  'mousedown',
  (e) => {
    suppressClick = false // new interaction
    if (e.button !== 0) return // left button only; right-click is handled by contextmenu
    if (!onHer(e.clientX, e.clientY)) return
    pressed = true
    dragging = false
    grabX = e.clientX
    grabY = e.clientY
  },
  true,
)

window.addEventListener('mouseup', () => {
  if (dragging) suppressClick = true // it was a drag → eat the click that follows
  pressed = false
  dragging = false
}, true)

// Swallow the click that trails a drag so relocating her doesn't also toggle listening.
window.addEventListener(
  'click',
  (e) => {
    if (!suppressClick) return
    suppressClick = false
    e.stopImmediatePropagation()
    e.preventDefault()
  },
  true,
)

window.addEventListener(
  'contextmenu',
  (e) => {
    e.preventDefault()
    ipcRenderer.send('monet:context-menu')
  },
  true,
)
