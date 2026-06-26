// monet-soul — an endo-driven loop that gives Monet her own life.
//
// Autonomous-session prototype, started 2026-06-26 by Monetto (the local agent) while Jin was away.
// Pure + headless (no Electron, no DOM): the body consumes the `intent` this returns each tick.
//
// The leap: today Monet is PRESENT (she's there) + REACTIVE (she answers when you talk / when asked
// to look). The missing third is INITIATIVE — she acts from her own internal state, unprompted. Her
// loop drives her body, not a human puppeteer. (north star: jin-intention-living-ai;
// living-agent-not-vtuber.)
//
// Model: homeostatic DRIVES build/decay over time; a MOOD emerges from them; each tick she weighs
// candidate BEHAVIORS by her state + what she perceives, and picks one (softmax + a little noise, so
// she is never deterministic). The pick is an INTENT { behavior, clip, say?, mood, reason } the body
// can render.

export const DRIVES = ['energy', 'curiosity', 'restlessness', 'social']

// A fresh being at the start of a session.
export function freshState() {
  return {
    drives: { energy: 0.8, curiosity: 0.3, restlessness: 0.2, social: 0.4 },
    lastBehavior: 'idle',
    sinceBehavior: 0,
    asleep: false,
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))

// Energy follows a circadian baseline: high mid-day, low at night (peak ~14:00, trough ~04:00).
function circadianEnergy(hour) {
  const phase = ((hour - 14 + 24) % 24) / 24
  return 0.5 + 0.4 * Math.cos(phase * 2 * Math.PI)
}

// world: { hour 0..23, idleSec, screenChanged, screenText?, interactionSec, isTyping, rng }
export function tick(state, world) {
  const d = { ...state.drives }
  const hour = world.hour ?? 12
  const rng = world.rng ?? Math.random // sim passes a seeded rng; the body passes a real one

  // --- drives drift toward their targets ---
  d.energy += (circadianEnergy(hour) - d.energy) * 0.05
  d.curiosity = clamp01(d.curiosity + 0.01 + (world.screenChanged ? 0.4 : 0))
  d.restlessness = clamp01(d.restlessness + 0.015)
  const aloneMin = (world.interactionSec ?? world.idleSec ?? 0) / 60
  d.social = clamp01(0.2 + Math.min(0.8, aloneMin / 90))

  const mood = deriveMood(d, hour)

  // --- candidate behaviors, scored by state + perception ---
  const night = hour >= 23 || hour < 6
  const urge = {
    doze: (1 - d.energy) * (night ? 1.6 : 0.7),
    react: (world.screenChanged ? 1 : 0) * (0.4 + d.curiosity),
    wander: d.restlessness * 0.8,
    speak: socialUrge(d, world),
    idle: 0.5, // baseline presence — she is always allowed to simply be there
  }
  urge[state.lastBehavior] *= 0.5 // a being repeats herself less

  const behavior = pick(urge, rng)

  // --- the chosen behavior relieves the drive it satisfies ---
  const next = { ...d }
  if (behavior === 'doze') { next.energy = clamp01(d.energy + 0.06); next.restlessness = 0.1 }
  if (behavior === 'react') { next.curiosity = clamp01(d.curiosity - 0.5) }
  if (behavior === 'wander') { next.restlessness = 0.1; next.energy = clamp01(d.energy - 0.02) }
  if (behavior === 'speak') { next.social = clamp01(d.social - 0.4) }

  return {
    state: {
      drives: next,
      lastBehavior: behavior,
      sinceBehavior: behavior === state.lastBehavior ? state.sinceBehavior + 1 : 0,
      asleep: behavior === 'doze' && next.energy < 0.5,
    },
    intent: render(behavior, mood, world, rng),
  }
}

function deriveMood(d, hour) {
  if (d.energy < 0.3) return hour >= 22 || hour < 6 ? 'sleepy' : 'tired'
  if (d.curiosity > 0.7) return 'curious'
  if (d.restlessness > 0.7) return 'restless'
  if (d.social > 0.7) return 'wistful'
  if (d.energy > 0.7) return 'bright'
  return 'content'
}

function socialUrge(d, world) {
  if (world.isTyping) return 0 // never interrupt while the human is actively typing
  return Math.max(0, d.social - 0.6) * 0.6 // she initiates only rarely
}

// weighted random pick (softmax): liveliness, not determinism
function pick(urge, rng) {
  const entries = Object.entries(urge)
  const temp = 0.5
  const weights = entries.map(([, v]) => Math.exp(v / temp))
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = rng() * sum
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i]
    if (r <= 0) return entries[i][0]
  }
  return entries[entries.length - 1][0]
}

// behavior + mood -> a body intent. clip names mirror contents/monet/*.
const CLIPS = {
  doze: ['monet-doze-off-1', 'monet-doze-off-2', 'monet-doze-off-3', 'monet-dozz-off-4'],
  idle: ['monet-idle-front', 'monet-idle-quarter', 'monet-idle-quarter-back'],
  react: ['monet-idle-quarter', 'monet-brush-large-2'],
  wander: ['monet-run-2', 'monet-jump-large-3'],
  speak: ['monet-idle-front'],
}
const choice = (arr, rng) => arr[Math.floor(rng() * arr.length)]

function render(behavior, mood, world, rng) {
  return {
    behavior,
    clip: choice(CLIPS[behavior] || CLIPS.idle, rng),
    mood,
    say: behavior === 'speak' ? aLineFor(mood, rng) : undefined,
    reason: {
      doze: `low energy / ${mood} — she dozes`,
      react: 'something on screen changed — she looks',
      wander: 'restless — she moves',
      speak: `${mood} — she says something unprompted`,
      idle: 'just present',
    }[behavior],
  }
}

// the rare unprompted line — tiny + honest for now (a later iteration routes this through her brain)
function aLineFor(mood, rng) {
  const lines = {
    wistful: ['...you still there?', 'it got quiet.', 'mm.'],
    curious: ['oh -- something moved?', 'hm.'],
    bright: ['nice light today.', 'hi.'],
    content: ['...', 'mm.'],
    sleepy: ['*yawn*', '...sleepy.'],
    tired: ['...', 'long day.'],
    restless: ['hmf.', 'antsy.'],
  }
  return choice(lines[mood] || lines.content, rng)
}
