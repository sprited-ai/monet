// Simulate a day of Monet's life — feed synthetic time/idle/screen events, watch what she does.
//   node experiments/monet-soul/sim.mjs
// A reproducible day (seeded RNG) so tuning is measurable across iterations.

import { freshState, tick } from './soul.mjs'

// mulberry32 — tiny seeded PRNG (Math.random is non-deterministic and banned in some contexts)
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const seed = Number(process.argv[2] || 42)
const r = makeRng(seed)
let state = freshState()

const TICKS = 144 // one tick per simulated 10 minutes -> 24h
const day = []
let lastChange = 0
for (let i = 0; i < TICKS; i++) {
  const hour = ((i * 10) / 60) % 24
  // human is "at the machine" during the day; idle/asleep at night
  const present = hour > 8 && hour < 23 && r() > 0.3
  const idleSec = present ? Math.floor(r() * 120) : (i - lastChange) * 600
  const screenChanged = present && r() > 0.7
  if (screenChanged) lastChange = i
  const world = {
    hour,
    idleSec,
    screenChanged,
    interactionSec: idleSec,
    isTyping: present && r() > 0.8,
    rng: r,
  }
  const res = tick(state, world)
  state = res.state
  day.push({ hour, intent: res.intent })
}

const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`
const counts = {}
let last = null
console.log(`— Monet's day (seed ${seed}) —\n`)
for (const { hour, intent } of day) {
  counts[intent.behavior] = (counts[intent.behavior] || 0) + 1
  if (intent.behavior !== last || intent.say) {
    const note = intent.say ? `"${intent.say}"` : intent.reason
    console.log(`${hh(hour)}  ${intent.behavior.padEnd(7)} ${('(' + intent.mood + ')').padEnd(11)} ${note}`)
    last = intent.behavior
  }
}
console.log('\n— how she spent the day —')
for (const [b, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${b.padEnd(8)} ${Math.round((c / TICKS) * 100)}%  ${'#'.repeat(c)}`)
}
