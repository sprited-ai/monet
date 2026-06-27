// loop.mjs — Monet's heartbeat on a real wall clock.
//
// Wraps the pure soul (soul.mjs) in a ticker: every beat it builds a `world` from a perception
// source, calls tick(), and returns the intent the body should act on. Headless-testable — inject a
// fake clock + perception and run a whole day in milliseconds. In the real body the perception
// source reads Electron's powerMonitor.getSystemIdleTime() + diffs the screen-read text (WIRING.md);
// here a synthetic one lets it run standalone.
//
//   node experiments/monet-soul/loop.mjs          # live: a real heartbeat, logs intents (Ctrl-C)
//   node experiments/monet-soul/loop.mjs --demo   # fast: hours of her life in milliseconds

import { freshState, restoreState, serialize, tick } from './soul.mjs'

// A heartbeat you step(). `now` returns something with getHours(); `perceive` returns the rest of
// the world (idleSec/screenChanged/interactionSec/isTyping). The loop owns the clock; the body owns
// perception. (This is the whole driver-swap seam from WIRING.md.)
export function createHeart({ now = () => new Date(), perceive = () => ({}), rng, restore } = {}) {
  // `restore` may be a whole saved inner state (resume her DAY) or just a bond (remember you only).
  let state = restore && restore.drives ? restoreState(restore, now().getHours()) : freshState(now().getHours(), restore)
  return {
    get state() {
      return state
    },
    snapshot() {
      return serialize(state) // hand this to the body to persist; pass it back as `restore` next launch
    },
    beat() {
      const world = { hour: now().getHours(), idleSec: 0, screenChanged: false, isTyping: false, ...perceive(), rng }
      const res = tick(state, world)
      state = res.state
      return res.intent
    },
  }
}

const line = (i, when) =>
  `${when}  ${i.behavior.padEnd(6)} ${i.clip.padEnd(26)} ${i.say ? `"${i.say}"` : i.reason}`

// ── a richer LIVE view: her inner weather, not a log line ──────────────────────────────────────
const MOOD_ICON = { bright: '☀️ ', content: '🙂', curious: '👀', wistful: '🌧️ ', sleepy: '😴', tired: '😪', restless: '😤' }
const bar = (v) => {
  const n = Math.max(0, Math.min(18, Math.round((v ?? 0) * 18)))
  return '█'.repeat(n) + '·'.repeat(18 - n)
}
const clockIcon = (h) => (h >= 23 || h < 6 ? '🌙' : h < 9 ? '🌅' : h < 18 ? '☀️ ' : '🌆')

function panel(intent, hour, min, lastSay, saidAge) {
  const m = intent.meta || {}
  const hhmm = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  const row = (label, v) => `   ${label.padEnd(10)} ${bar(v)}  ${(v ?? 0).toFixed(2)}`
  return [
    '',
    `   Monet                                ${clockIcon(hour)} ${hhmm}`,
    '   ────────────────────────────────────────────────',
    `   ${MOOD_ICON[intent.mood] || '·'}  ${intent.mood.padEnd(9)}   knows you ${m.daysKnown ?? 1}d · familiarity ${(m.familiarity ?? 0).toFixed(2)}`,
    '',
    row('energy', m.energy),
    row('curiosity', m.curiosity),
    row('restless', m.restlessness),
    row('social', m.social),
    '',
    `   ▸ ${intent.behavior} · ${intent.clip}`,
    `     ${intent.reason}`,
    saidAge < 6 && lastSay ? `   💬 “${lastSay}”` : '',
    '',
  ].join('\n')
}

// Watch a whole day of her inner life flow by, live + in place (a beat every ~stepMs, time
// accelerated). The most meaningful headless view — you see her wake, play, nap, greet while her
// drives and mood actually move, not a dry log.
export function watch({ stepMs = 650, minPerBeat = 12, startHour = 6 } = {}) {
  let r = 20260626
  const rng = () => {
    r = (r * 1103515245 + 12345) & 0x7fffffff
    return r / 0x7fffffff
  }
  let simMin = startHour * 60
  let t = 0
  let lastChange = 0
  let lastSay = ''
  let saidAge = 99
  const now = () => ({ getHours: () => Math.floor((simMin / 60) % 24) })
  const perceive = () => {
    const present = rng() > 0.4
    const idleSec = present ? Math.floor(rng() * 120) : (t - lastChange) * 600
    const screenChanged = present && rng() > 0.7
    if (screenChanged) lastChange = t
    return { idleSec, screenChanged, interactionSec: idleSec, isTyping: present && rng() > 0.85 }
  }
  const heart = createHeart({ now, perceive, rng })
  process.stdout.write('\x1b[?25l\x1b[2J') // hide cursor, clear
  const id = setInterval(() => {
    const intent = heart.beat()
    if (intent.say) {
      lastSay = intent.say
      saidAge = 0
    } else saidAge++
    process.stdout.write('\x1b[H' + panel(intent, Math.floor((simMin / 60) % 24), simMin % 60, lastSay, saidAge) + '\x1b[J')
    simMin += minPerBeat
    t++
  }, stepMs)
  process.on('SIGINT', () => {
    clearInterval(id)
    process.stdout.write('\x1b[?25h\n· she rests ·\n')
    process.exit(0)
  })
}

// Live: a real wall-clock heartbeat, rendered as her inner-weather panel, in place. (The body would
// call heart.beat() on its own timer and render her actual animated self instead of this panel.)
export function live({ intervalMs = 2000 } = {}) {
  const heart = createHeart()
  let lastSay = ''
  let saidAge = 99
  process.stdout.write('\x1b[?25l\x1b[2J') // hide cursor, clear
  const id = setInterval(() => {
    const intent = heart.beat()
    if (intent.say) {
      lastSay = intent.say
      saidAge = 0
    } else saidAge++
    const d = new Date()
    process.stdout.write('\x1b[H' + panel(intent, d.getHours(), d.getMinutes(), lastSay, saidAge) + '\x1b[J')
  }, intervalMs)
  process.on('SIGINT', () => {
    clearInterval(id)
    process.stdout.write('\x1b[?25h\n· she rests ·\n')
    process.exit(0)
  })
}

// Demo: a fake clock so we can watch hours pass in an instant — proof the same heart that would tick
// in the body produces a believable day.
export function demo({ hours = 8, startHour = 7 } = {}) {
  let r = 20260626
  const rng = () => {
    r = (r * 1103515245 + 12345) & 0x7fffffff
    return r / 0x7fffffff
  }
  let simMin = startHour * 60
  const now = () => ({ getHours: () => Math.floor((simMin / 60) % 24) })
  let t = 0
  let lastChange = 0
  const perceive = () => {
    const present = rng() > 0.35
    const idleSec = present ? Math.floor(rng() * 120) : (t - lastChange) * 600
    const screenChanged = present && rng() > 0.7
    if (screenChanged) lastChange = t
    return { idleSec, screenChanged, interactionSec: idleSec, isTyping: present && rng() > 0.85 }
  }
  const heart = createHeart({ now, perceive, rng })
  console.log(`· ${hours}h of her life, from ${startHour}:00 (one beat = 10 min) ·\n`)
  let last = null
  for (t = 0; t < hours * 6; t++) {
    const i = heart.beat()
    const hh = `${String(Math.floor((simMin / 60) % 24)).padStart(2, '0')}:${String(simMin % 60).padStart(2, '0')}`
    if (i.behavior !== last || i.say) {
      console.log(line(i, hh))
      last = i.behavior
    }
    simMin += 10
  }
}

// CLI
const mode = process.argv[2]
if (mode === '--demo') demo() // fast text log of a day
else if (mode === '--watch') watch() // ⭐ live inner-weather panel, a day accelerated
else if (process.argv[1] && process.argv[1].endsWith('loop.mjs')) live() // live panel, real clock
