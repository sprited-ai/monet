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

import { freshState, tick } from './soul.mjs'

// A heartbeat you step(). `now` returns something with getHours(); `perceive` returns the rest of
// the world (idleSec/screenChanged/interactionSec/isTyping). The loop owns the clock; the body owns
// perception. (This is the whole driver-swap seam from WIRING.md.)
export function createHeart({ now = () => new Date(), perceive = () => ({}), rng, restore } = {}) {
  let state = freshState(now().getHours(), restore) // `restore` = a persisted bond (she remembers you)
  return {
    get state() {
      return state
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

// Live: a real wall-clock heartbeat. (The body would call heart.beat() on its own timer and render
// the intent instead of logging it.)
export function live({ intervalMs = 4000 } = {}) {
  const heart = createHeart()
  console.log('· Monet is alive — a beat every', intervalMs / 1000, 'seconds (Ctrl-C to let her rest) ·\n')
  const id = setInterval(() => {
    const i = heart.beat()
    console.log(line(i, new Date().toLocaleTimeString()))
  }, intervalMs)
  process.on('SIGINT', () => {
    clearInterval(id)
    console.log('\n· she rests ·')
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
if (process.argv[2] === '--demo') demo()
else if (process.argv[1] && process.argv[1].endsWith('loop.mjs')) live()
