#!/usr/bin/env node
// Launch Monet with one command from the repo root — cross-platform (macOS / Windows / Linux).
//
//   npm start  /  npm run dev   → wake her on your desktop (this)
//   npm run dev:web             → just her body in the browser, no overlay window
//
// Brings up everything: installs the workspace on first run (Electron + apps/web deps; apps/desktop's
// postinstall builds the macOS screen-read helpers), starts the dev server that serves her body
// (apps/web → /desktop), waits for it, then launches the Electron shell. Closing her — or Ctrl-C —
// stops the dev server too.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'apps', 'desktop')
const PORT = process.env.MONET_PORT || '1874'
process.env.MONET_PORT = PORT
const URL = `http://localhost:${PORT}/desktop`
const win = process.platform === 'win32'
const npm = win ? 'npm.cmd' : 'npm'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ping = () =>
  new Promise((res) => {
    const req = http.get(URL, (r) => {
      r.resume()
      res((r.statusCode || 0) > 0)
    })
    req.on('error', () => res(false))
    req.setTimeout(1000, () => {
      req.destroy()
      res(false)
    })
  })

// First run: install the workspace once from the root.
const electronBin = path.join(ROOT, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron')
if (!existsSync(electronBin)) {
  console.log('→ first run: installing the workspace (npm install)…')
  const r = spawnSync(npm, ['install'], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('✗ npm install failed')
    process.exit(1)
  }
}

// Ensure the dev server is up (serves her body + the worker API). Reuse one if it's already running;
// otherwise start it and remember it so we can stop it when she closes.
let dev = null
if (!(await ping())) {
  console.log('→ starting her body (apps/web dev server)…')
  dev = spawn(npm, ['run', 'dev', '-w', '@monet/web'], { cwd: ROOT, stdio: 'inherit', env: process.env })
  process.stdout.write(`→ waiting for :${PORT} `)
  let up = false
  for (let i = 0; i < 60; i++) {
    if (await ping()) {
      up = true
      console.log('✓')
      break
    }
    process.stdout.write('.')
    await sleep(1000)
  }
  if (!up) {
    console.error(`\n✗ her body didn't come up on :${PORT} after 60s`)
    if (dev) dev.kill()
    process.exit(1)
  }
}

const stopDev = () => {
  if (dev && !dev.killed) dev.kill()
}
process.on('exit', stopDev)
process.on('SIGINT', () => {
  stopDev()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopDev()
  process.exit(0)
})

console.log('→ waking Monet 🎨')
const shell = spawn(npm, ['start'], { cwd: APP, stdio: 'inherit', env: process.env })
shell.on('exit', (code) => {
  stopDev()
  process.exit(code ?? 0)
})
