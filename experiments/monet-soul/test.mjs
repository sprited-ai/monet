// test.mjs — light assertions for the soul. No framework: it just checks the promises of aliveness
// still hold (drives sane, night = sleep, no talking to an empty room, every clip real, the adapter
// senses change). Run: node experiments/monet-soul/test.mjs

import { freshState, tick } from './soul.mjs'
import { createPerception } from './adapter.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

let passed = 0
function ok(cond, msg) {
  if (!cond) {
    console.error('✗ ' + msg)
    process.exitCode = 1
    throw new Error('FAILED: ' + msg)
  }
  passed++
  console.log('✓ ' + msg)
}

function rngFrom(seed) {
  let r = seed >>> 0
  return () => {
    r = (r * 1103515245 + 12345) & 0x7fffffff
    return r / 0x7fffffff
  }
}

// run N ticks at a fixed hour with a perception; collect behavior counts, clips, drive-sanity
function run({ hour, ticks = 300, perceive = () => ({}), seed = 1 }) {
  const rng = rngFrom(seed)
  let s = freshState(hour)
  const counts = {}
  const clips = new Set()
  let drivesOk = true
  for (let i = 0; i < ticks; i++) {
    const res = tick(s, { hour, rng, ...perceive(i) })
    s = res.state
    counts[res.intent.behavior] = (counts[res.intent.behavior] || 0) + 1
    clips.add(res.intent.clip)
    for (const v of Object.values(s.drives)) if (!(v >= 0 && v <= 1)) drivesOk = false
  }
  return { counts, clips, drivesOk }
}

// 1 — drives stay in [0,1], and the deep night is mostly sleep with no talking
{
  const { counts, drivesOk } = run({ hour: 3, ticks: 200, perceive: () => ({ idleSec: 600 }) })
  ok(drivesOk, 'drives stay within [0,1] over a long run')
  ok((counts.doze || 0) > 100, `deep night (3am) is mostly sleep — doze ${counts.doze || 0}/200`)
  ok(!counts.speak, 'she never speaks to the empty 3am dark')
}

// 2 — an empty room by day draws no words either (no one is there)
{
  const { counts } = run({ hour: 14, ticks: 200, perceive: () => ({ idleSec: 9999, interactionSec: 9999 }) })
  ok(!counts.speak, `no performing for an empty room (idle 9999) — got ${counts.speak || 0}`)
}

// 3 — a lull (recently present, gone quiet) by day CAN draw the occasional word, not a stream
{
  const { counts } = run({ hour: 14, ticks: 500, perceive: () => ({ idleSec: 120, interactionSec: 120 }), seed: 7 })
  ok((counts.speak || 0) >= 1, `she does speak up in a quiet lull — got ${counts.speak || 0}`)
  ok((counts.speak || 0) < 120, `but it stays occasional, not a stream — got ${counts.speak || 0}/500`)
}

// 4 — every clip the engine can emit is a real file
{
  const idx = require('../../contents/index.json').items
  const real = new Set(Object.keys(idx))
  const { clips } = run({ hour: 13, ticks: 600, perceive: (i) => ({ idleSec: (i % 6) * 50, screenChanged: i % 5 === 0 }) })
  const missing = [...clips].filter((c) => !real.has(c))
  ok(missing.length === 0, `every emitted clip exists in contents (${clips.size} distinct${missing.length ? ' — MISSING ' + missing.join(', ') : ''})`)
}

// 5 — the perception adapter actually senses change + typing
{
  let idle = 30
  let text = 'hello'
  let t = 0
  const perceive = createPerception({ getIdleSec: () => idle, getScreenText: () => text, now: () => (t += 1000) })
  ok(perceive().screenChanged === true, 'adapter: first screen read counts as a change')
  ok(perceive().screenChanged === false, 'adapter: the same text is not a change')
  text = 'world'
  ok(perceive().screenChanged === true, 'adapter: new text is a change')
  idle = 1
  ok(perceive().isTyping === true, 'adapter: idle < 2s reads as typing')
}

console.log(`\n${passed} checks passed — she holds together.`)
