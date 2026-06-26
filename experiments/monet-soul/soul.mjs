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
export function freshState(hour = 12) {
  const night = hour >= 23 || hour < 6
  return {
    // energy is seeded from the clock: launch her at 2am and she starts sleepy, not "bright".
    drives: { energy: circadianEnergy(hour), curiosity: 0.3, restlessness: 0.2, social: 0.4 },
    lastBehavior: night ? 'doze' : 'idle',
    sinceBehavior: 0,
    sinceSpoke: 99, // ticks since she last spoke (a cooldown so she isn't chatty)
    sincePlayed: 99, // ticks since she last did her own thing
    asleep: night,
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))

// Energy follows a circadian baseline: high mid-day, low at night (peak ~14:00, trough ~04:00).
function circadianEnergy(hour) {
  const phase = ((hour - 14 + 24) % 24) / 24
  return 0.45 + 0.45 * Math.cos(phase * 2 * Math.PI) // ~0.0 trough at 04:00, ~0.9 peak at 14:00
}

// world: { hour 0..23, idleSec, screenChanged, screenText?, interactionSec, isTyping, rng }
export function tick(state, world) {
  const d = { ...state.drives }
  const hour = world.hour ?? 12
  const rng = world.rng ?? Math.random // sim passes a seeded rng; the body passes a real one

  // --- drives drift; the circadian clock leads energy ---
  d.energy += (circadianEnergy(hour) - d.energy) * 0.08
  d.curiosity = clamp01(d.curiosity + 0.01 + (world.screenChanged ? 0.4 : 0))
  d.restlessness = clamp01(d.restlessness + 0.015)
  const aloneMin = (world.interactionSec ?? world.idleSec ?? 0) / 60
  d.social = clamp01(0.2 + Math.min(0.8, aloneMin / 90))

  const mood = deriveMood(d, hour)
  const night = hour >= 23 || hour < 6

  // --- candidate behaviors, scored by state + perception ---
  const urge = {
    // deep pull at night; by day she only naps when genuinely low (energy < 0.5), not just idle
    doze: night ? (1 - d.energy) * 2.2 : Math.max(0, 0.5 - d.energy) * 1.3,
    react: (world.screenChanged ? 1 : 0) * (0.4 + d.curiosity),
    wander: d.restlessness * (night ? 0.2 : 0.8), // she barely roams at night
    play: playUrge(d, world, hour, state.sincePlayed ?? 99),
    speak: socialUrge(d, world, hour, state.sinceSpoke ?? 99),
    idle: 0.5, // baseline presence — she is always allowed to simply be there
  }

  // hysteresis: hold the current behavior for a bit (momentum fades with sinceBehavior) so she
  // doesn't flip every tick. ONLY sustained poses get momentum — doze/idle/wander are things she
  // *holds*; react/speak are one-shot acts (momentum on speak would defeat its cooldown). doze gets
  // extra so she sleeps THROUGH the night, not in flickers.
  const SUSTAINED = ['doze', 'idle', 'wander', 'play']
  if (SUSTAINED.includes(state.lastBehavior)) {
    urge[state.lastBehavior] += (state.lastBehavior === 'doze' ? 1.8 : 0.9) / (1 + state.sinceBehavior * 0.5)
  }

  const behavior = pick(urge, rng)

  // --- the chosen behavior relieves the drive it satisfies ---
  const next = { ...d }
  if (behavior === 'doze') { next.energy = clamp01(d.energy + 0.03); next.restlessness = 0.1 }
  if (behavior === 'react') { next.curiosity = clamp01(d.curiosity - 0.5) }
  if (behavior === 'wander') { next.restlessness = 0.1; next.energy = clamp01(d.energy - 0.02) }
  if (behavior === 'play') { next.restlessness = 0.1; next.energy = clamp01(d.energy - 0.04) }
  if (behavior === 'speak') { next.social = clamp01(d.social - 0.4) }

  return {
    state: {
      drives: next,
      lastBehavior: behavior,
      sinceBehavior: behavior === state.lastBehavior ? state.sinceBehavior + 1 : 0,
      sinceSpoke: behavior === 'speak' ? 0 : (state.sinceSpoke ?? 0) + 1,
      sincePlayed: behavior === 'play' ? 0 : (state.sincePlayed ?? 0) + 1,
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

// She speaks unprompted ONLY in a brief lull — they were just here and went quiet — never to an
// empty room, never deep at night, never over active typing. A companion, not a performer.
function socialUrge(d, world, hour, sinceSpoke) {
  if (world.isTyping || hour >= 23 || hour < 6) return 0
  if (sinceSpoke < 6) return 0 // cooldown: she just spoke — don't chatter
  const idle = world.idleSec ?? 999
  if (idle <= 45 || idle >= 300) return 0 // recent presence + a quiet beat (~45s–5min)
  return 0.35 + 0.25 * d.social // modest; pick() + idle's own weight keep it occasional
}

// Her own hobbies — paints, dances, a little magic — done for herself when she has the energy and
// it's daytime. Never at night; eased off (not zero) while you're heads-down typing. A cooldown keeps
// it to occasional bursts, not a nonstop performance.
function playUrge(d, world, hour, sincePlayed) {
  if (hour >= 23 || hour < 6) return 0
  if (d.energy < 0.55 || sincePlayed < 10) return 0
  return (d.energy - 0.55) * 1.4 * (world.isTyping ? 0.5 : 1)
}

// weighted random pick (softmax): liveliness, not determinism
function pick(urge, rng) {
  // urge <= 0 means "not a candidate this tick" (a gated/cooled-down behavior). Without this filter
  // softmax would give even a 0-urge behavior weight exp(0)=1 — so "off" wouldn't actually be off.
  const entries = Object.entries(urge).filter(([, v]) => v > 0.001)
  if (!entries.length) return 'idle'
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

// behavior (+ mood) -> a REAL clip from contents/monet. Some behaviors pick a mood-flavored clip;
// the rest pick from a pool. (All names verified against contents/index.json.)
const CLIPS = {
  doze: ['monet-doze-off-1', 'monet-doze-off-2', 'monet-doze-off-3', 'monet-dozz-off-4', 'monet-pillow'],
  idle: {
    default: ['monet-idle-front', 'monet-idle-quarter', 'monet-idle-quarter-back', 'monet-idle-1', 'monet-idle-2', 'monet-sit-1', 'monet-chill-large-1'],
    bright: ['monet-happy-1', 'monet-happy-2', 'monet-idle-front'],
    wistful: ['monet-sad-large', 'monet-idle-quarter-back'],
    sleepy: ['monet-sit', 'monet-chill-large-1'],
    tired: ['monet-sit', 'monet-idle-quarter-back'],
  },
  react: ['monet-lookup-3', 'monet-turns', 'monet-idle-quarter', 'monet-turn-twice-1'],
  wander: ['monet-walk', 'monet-run-2', 'monet-jump-large-3', 'monet-turns-back-to-front-1'],
  // her own hobbies — she does these FOR HERSELF, not for you. the most 'alive' beat there is.
  play: {
    default: ['monet-paint-large-1', 'monet-light-dance-1', 'monet-cast-magic-1', 'monet-flower-magic-1'],
    bright: ['monet-dance-large-1', 'monet-jumping-jacks-large-1', 'monet-cast-magic-2', 'monet-paint-large-1'],
  },
  speak: {
    default: ['monet-talk-2', 'monet-talk-large-1'],
    bright: ['monet-talk-happy-large-1'],
    wistful: ['monet-talk-sad-stuff-large-1'],
  },
}
const choice = (arr, rng) => arr[Math.floor(rng() * arr.length)]
function clipFor(behavior, mood, rng) {
  const set = CLIPS[behavior] || CLIPS.idle
  return Array.isArray(set) ? choice(set, rng) : choice(set[mood] || set.default, rng)
}

function render(behavior, mood, world, rng) {
  return {
    behavior,
    clip: clipFor(behavior, mood, rng),
    mood,
    say: behavior === 'speak' ? aLineFor(mood, rng) : undefined,
    reason: {
      doze: `low energy / ${mood} — she dozes`,
      react: 'something on screen changed — she looks',
      wander: 'restless — she moves',
      play: 'energized + content — she does her own thing (paints / dances / a little magic)',
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
