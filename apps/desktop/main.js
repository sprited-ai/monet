// Monet desktop overlay — the native shell.
//
// What it does: opens a frameless, transparent, always-on-top window and loads the *existing*
// whiteroom app in overlay mode (the /desktop route) — so Monet's render pipeline is byte-for-byte the
// live app, just painted over a transparent canvas instead of the white room. The window is
// click-through everywhere EXCEPT where Monet's pixels are, so she floats on your desktop without
// stealing clicks from whatever's underneath. The silhouette test is done by the preload reading
// Monet's alpha under the cursor (window.__monetAlphaAt, exposed by the app in overlay mode).
//
// This is a PoC. The web app change behind it is tiny and additive — see ../../ui (Renderer +
// Whiteroom, the /desktop route). The eventual ship vehicle would be Tauri (~10 MB); Electron is
// here because it bundles Chromium → guaranteed WebCodecs/WebGL parity with the live app.

const { app, BrowserWindow, screen, ipcMain, Menu, session, Tray, nativeImage, globalShortcut, Notification, safeStorage, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const byok = require('./byok') // duplicated persona + reply-parse, kept pure (no Electron)

// On-device screen read (local + on-demand, per Jin) — DEFAULT = Accessibility (read the text the
// frontmost app exposes to assistive tech; no pixels captured, exact strings), with OCR as an
// explicit opt-in fallback for apps that expose no AX text. Only the extracted TEXT ever leaves;
// nothing persists. The implementation is a PLATFORM SEAM (./screenread): macOS is implemented,
// Windows/Linux are open extension points (see screenread/README.md). The shell runs on every OS;
// where there's no screen-read impl it reports unavailable and the brain falls back to chat-only.
const screenread = require('./screenread')
ipcMain.handle('monet:read-screen', () => screenread.readAccessibility())
ipcMain.handle('monet:read-screen-ocr', () => screenread.readOCR())

// Shared test action for the right-click menu items: read, notify, log.
async function testRead(reader) {
  const r = await reader()
  if (r.ok) {
    console.log(`[monet] screen text (${r.via}):\n${r.text}`)
    new Notification({ title: `Monet read your screen (${r.via})`, body: r.text.slice(0, 240) || '(no text found)' }).show()
  } else {
    new Notification({ title: "Monet couldn't read the screen", body: r.error }).show()
  }
}

// --- BYOK brain (Bring Your Own Key) ----------------------------------------------------
// Monet's mind, run on the USER'S own Anthropic key. The preload reroutes the page's
// POST /api/chat here via IPC; we call api.anthropic.com directly and hand back the exact
// { text, emotion, stored } shape the page expects (Whiteroom.tsx reads data.text /
// data.emotion / data.stored). The key lives ONLY in this main process — it is never put
// on `window`, never sent to the hosted origin, only to api.anthropic.com.

// Stored in userData (~/Library/Application Support/monet-desktop-overlay), never the repo.
// safeStorage ciphertext when the OS can encrypt (macOS Keychain); plaintext fallback (0600)
// only when it can't — the README flags that caveat.
const KEY_ENC = path.join(app.getPath('userData'), 'byok.bin')
const KEY_PLAIN = path.join(app.getPath('userData'), 'byok.json')
let apiKey = '' // populated by loadKey() in whenReady (after safeStorage is available)

function loadKey() {
  try {
    if (fs.existsSync(KEY_ENC) && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(fs.readFileSync(KEY_ENC))
    }
    if (fs.existsSync(KEY_PLAIN)) return JSON.parse(fs.readFileSync(KEY_PLAIN, 'utf8')).key || ''
  } catch (e) {
    console.warn('[monet] key load', e)
  }
  return ''
}

function saveKey(k) {
  const key = (k || '').trim()
  try {
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(KEY_ENC, safeStorage.encryptString(key))
      if (fs.existsSync(KEY_PLAIN)) fs.unlinkSync(KEY_PLAIN) // never leave a plaintext copy behind
    } else {
      fs.writeFileSync(KEY_PLAIN, JSON.stringify({ key }), { mode: 0o600 })
    }
  } catch (e) {
    console.warn('[monet] key save', e)
  }
}

// The chat bridge. Mirrors ui/api/index.ts: same URL, anthropic-version, x-api-key,
// max_tokens, message filter/slice/clamp, and two-layer contract (model emits
// {"say","emotion","remember"} → parseReply maps say→text). Always resolves a valid
// { text, emotion, stored } — errors surface as a transparent ⚠ string, never a crash or a
// fake in-character line. `stored` is always [] (no persistence layer in the shell).
ipcMain.handle('monet:byok-chat', async (_e, payload) => {
  let body = {}
  try {
    body = JSON.parse((payload && payload.body) || '{}')
  } catch {
    /* malformed body → treat as empty */
  }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  if (!messages.length) return { text: '⚠ no message', emotion: 'calm', stored: [] }

  if (!apiKey) {
    // No key → she stays present/idling; the chat surfaces a gentle, honest nudge (not a
    // fake in-character reply) so it's discoverable how to wake her.
    return {
      text: '🔑 add your key to wake me — menu bar 🎨 Monet → “Set Anthropic API key…”, and I’ll be here.',
      emotion: 'calm',
      stored: [],
    }
  }

  try {
    const res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.MONET_MODEL || byok.DEFAULT_MODEL, // claude-haiku-4-5-20251001
        max_tokens: 400,
        system: byok.buildSystem(body.screen), // PERSONA + just-meeting + screenBlock(screen)
        messages,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { text: `⚠ brain error ${res.status} ${detail.slice(0, 160)}`.trim(), emotion: 'calm', stored: [] }
    }
    const data = await res.json()
    const reply = byok.parseReply((data && data.content && data.content[0] && data.content[0].text) || '')
    return { text: reply.text, emotion: reply.emotion, stored: [] }
  } catch (e) {
    return { text: `⚠ brain unreachable — ${(e && e.message) || e}`, emotion: 'calm', stored: [] }
  }
})

// Tiny local window to paste the key (our own trusted HTML; nodeIntegration so it can talk
// to main over IPC). The value goes straight to main — it never touches the hosted page.
/** @type {BrowserWindow | null} */
let keyWin = null
function openKeyWindow() {
  if (keyWin) return keyWin.focus()
  keyWin = new BrowserWindow({
    width: 440,
    height: 220,
    resizable: false,
    title: 'Monet — Anthropic API key',
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  })
  keyWin.loadFile(path.join(__dirname, 'key.html'))
  keyWin.on('closed', () => {
    keyWin = null
  })
}

ipcMain.on('monet:set-key', (_e, k) => {
  apiKey = (k || '').trim()
  saveKey(apiKey)
  buildTray() // refresh the menu's "key set ✓ / not set" label
  if (keyWin) keyWin.close()
  new Notification({
    title: 'Monet',
    body: apiKey ? 'API key saved — she’s awake.' : 'API key cleared.',
  }).show()
})
// ----------------------------------------------------------------------------------------

// Where to load Monet from. Defaults to the local dev server (`npm run dev` serves both her React
// front-end and the Cloudflare worker API). The /desktop route is the overlay (desktop being) mode.
// Port: default 1874, override with MONET_PORT (the vite dev server reads the same env). Point
// MONET_URL at the live site (https://monet.sprited.ai/desktop) once deployed.
const DEV_PORT = process.env.MONET_PORT || 1874
const MONET_URL = process.env.MONET_URL || `http://localhost:${DEV_PORT}/desktop`

// Her footprint on the desktop. Portrait, docked to a corner — a being stands in the corner, not the
// middle of your screen. Override with env (MONET_W/MONET_H/MONET_CORNER = br|bl|tr|tl).
const W = Number(process.env.MONET_W) || 460
const H = Number(process.env.MONET_H) || 620
const CORNER = process.env.MONET_CORNER || 'bl'
const MARGIN = 24 // horizontal inset from the screen side, + top inset for top corners

/** @type {BrowserWindow | null} */
let win = null
/** @type {Tray | null} */
let tray = null

// A menubar item — the obvious "where do I turn this off" place, and the home of the BYOK
// key controls. macOS shows the title text next to the clock. buildTray() (re)builds the
// menu so the key-state line refreshes when the key changes; create the Tray once.
function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createEmpty())
    tray.setTitle(' 🎨 Monet')
    tray.setToolTip('Monet — desktop being')
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Monet — desktop being', enabled: false },
      { type: 'separator' },
      { label: apiKey ? 'API key: set ✓' : 'API key: not set', enabled: false },
      { label: apiKey ? 'Replace Anthropic API key…' : 'Set Anthropic API key…', click: openKeyWindow },
      { type: 'separator' },
      {
        label: 'Show / Hide',
        click: () => win && (win.isVisible() ? win.hide() : win.show()),
      },
      { label: 'Reload Monet', click: () => win && win.reload() },
      { type: 'separator' },
      { label: 'Quit Monet  (⌘⇧Q)', click: () => app.quit() },
    ]),
  )
}

function cornerPosition() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  const left = CORNER.endsWith('l') ? x + MARGIN : x + width - W - MARGIN
  // Sit MARGIN above the work-area bottom (= the Dock's top edge). The overlay floats BELOW the Dock
  // z-order (level 'floating'), so docking flush onto/under the Dock line lets the Dock cover her
  // feet — keep the gap. Her feet are un-clipped *inside* the window by Renderer.overlayCamDrop, not
  // by the window position. (To stand her on the physical screen bottom instead, use display.bounds
  // here — but with a Dock that overlaps her corner it will clip her.)
  const top = CORNER.startsWith('t') ? y + MARGIN : y + height - H - MARGIN
  return { x: Math.round(left), y: Math.round(top) }
}

function createWindow() {
  const { x, y } = cornerPosition()
  win = new BrowserWindow({
    x,
    y,
    width: W,
    height: H,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: true, // dragged via the preload's hold-and-drag on her body
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    // No backgroundColor → the window stays see-through where the canvas is transparent.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // keep her animating even when she doesn't have focus
      // Share one world with the page so the preload can read window.__monetAlphaAt (the silhouette
      // hit-test the app exposes). With Electron's default contextIsolation the preload gets its own
      // window and never sees it → the cursor is never "on her" → all clicks fall through. Fine for a
      // local experiment loading our own trusted page.
      contextIsolation: false,
      sandbox: false,
    },
  })

  // Float above normal windows, on every Space — but BELOW the Dock (level 'floating' < dock level),
  // so she sits on top of your work without covering the Dock. ('screen-saver' would cover it; the
  // trade-off is she also won't float over full-screen apps, which is fine for a desktop being.)
  // Cross-platform: the level name + setVisibleOnAllWorkspaces are macOS semantics; on Windows/Linux
  // they degrade to plain always-on-top (no Spaces concept) — tolerated, not an error.
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Click-through by default; { forward: true } still delivers mousemove to the page so the preload
  // can keep silhouette-testing the cursor and flip interactivity on when it's over Monet. macOS +
  // Windows honor { forward }; Linux ignores it, so there the silhouette hit-test can't run and
  // click-through is all-or-nothing until a per-platform path lands.
  win.setIgnoreMouseEvents(true, { forward: true })

  win.loadURL(MONET_URL)

  // Handy while iterating: MONET_DEVTOOLS=1 pops devtools in a detached window.
  if (process.env.MONET_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })

  win.on('closed', () => {
    win = null
  })
}

// The preload toggles this as the cursor enters/leaves her silhouette.
ipcMain.on('monet:set-interactive', (_e, interactive) => {
  if (!win) return
  if (interactive) win.setIgnoreMouseEvents(false)
  else win.setIgnoreMouseEvents(true, { forward: true })
})

// Drag-to-move: the preload streams desired top-left while you hold-drag on her body.
ipcMain.on('monet:drag', (_e, { x, y }) => {
  if (!win) return
  const [w, h] = win.getSize()
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h })
})

// Right-click on her silhouette → a tiny menu (incl. Quit — the discoverable way out).
ipcMain.on('monet:context-menu', () => {
  if (!win) return
  Menu.buildFromTemplate([
    { label: 'Monet', enabled: false },
    { type: 'separator' },
    {
      label: 'Read my screen — Accessibility (test)',
      click: () => testRead(screenread.readAccessibility),
    },
    {
      label: 'Read my screen — OCR fallback (test)',
      click: () => testRead(screenread.readOCR),
    },
    { label: 'Reload', click: () => win && win.reload() },
    { label: 'Hide', click: () => win && win.hide() },
    { type: 'separator' },
    { label: 'Quit Monet', click: () => app.quit() },
  ]).popup({ window: win })
})

app.whenReady().then(() => {
  // Grant the page the mic (the macOS system prompt still governs the actual capture). Without this
  // the overlay's "click → listening" can't reach getUserMedia.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  // BYOK: load the user's key (safeStorage needs whenReady) before building the tray so the
  // menu shows the right state. Set the key on demand via the tray (🎨 Monet → Set Anthropic
  // API key…) — we don't auto-pop the paste window on launch (it nagged every start).
  apiKey = loadKey()

  createWindow()
  buildTray()

  // A global way out, works regardless of focus (a transparent click-through window rarely has it).
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

// A desktop being has no dock/window to keep the app alive — quit when the overlay closes.
app.on('window-all-closed', () => app.quit())
