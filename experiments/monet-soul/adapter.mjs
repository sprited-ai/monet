// adapter.mjs — turn real OS signals into the soul's `world` perception.
//
// Pure + injected: you hand it the OS hooks, so it stays testable headless. In apps/desktop/main.js
// you wire the real ones — Electron's powerMonitor for idle, the screen-read seam for screen text —
// and feed the result into loop.mjs's createHeart({ perceive }). That's the whole driver swap.
//
//   getIdleSec()    -> seconds since the user touched mouse/keyboard   (powerMonitor.getSystemIdleTime)
//   getScreenText() -> the latest known foreground text, SYNC + cached  (body refreshes it off the
//                       screen-read seam on its own timer so the heartbeat never blocks on it)
//   now()           -> milliseconds (Date.now)

export function createPerception({ getIdleSec, getScreenText = () => '', now = () => Date.now() }) {
  let lastScreen = ''
  let lastInteraction = now()
  return () => {
    const idleSec = getIdleSec()
    if (idleSec < 2) lastInteraction = now() // they're at the keyboard right now
    const screen = (getScreenText() || '').slice(0, 4000)
    const screenChanged = screen !== '' && screen !== lastScreen
    lastScreen = screen
    return {
      idleSec,
      interactionSec: Math.round((now() - lastInteraction) / 1000),
      screenChanged,
      isTyping: idleSec < 2,
    }
  }
}

// ── How the body wires it (copy-paste sketch for apps/desktop/main.js; NOT applied here) ──────────
//
//   const { powerMonitor } = require('electron')
//   const screenread = require('./screenread')
//   const { createPerception } = require('<this module, once promoted into apps/desktop>')
//   const { createHeart } = require('<loop.mjs>')
//
//   // refresh the screen text off the seam on a slow timer so the heartbeat reads it for free:
//   let screenText = ''
//   setInterval(async () => { const r = await screenread.readAccessibility(); if (r.ok) screenText = r.text }, 5000)
//
//   const perceive = createPerception({
//     getIdleSec: () => powerMonitor.getSystemIdleTime(),  // seconds, built in, no permission
//     getScreenText: () => screenText,                     // sync read of the cached text
//   })
//   const heart = createHeart({ perceive })
//   setInterval(() => {
//     const intent = heart.beat()
//     win.webContents.send('monet:intent', intent)         // renderer plays intent.clip (see WIRING.md)
//   }, 4000)
//
// Reactive chat stays exactly as it is; this only adds the from-the-inside driver on top.
