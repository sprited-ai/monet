// Text → viseme schedule. The SPINE of Monet's lip-sync: mouth SHAPE always comes from text,
// in both the no-audio and with-audio paths. Amplitude (voice.ts mouthOpen) only MULTIPLIES
// openness — it never picks the viseme. Timing is the estimated speaking-rate model below for
// the no-audio path; the with-audio path rescales onto ElevenLabs character timestamps.
//
// VISEME SET = the 19-viseme scheme from hatanasinclaire/mas-lipsync-prototype (Jin's pick as
// the base; he'll tweak the shapes/art later). Viseme IDs are numbers 0..18, matching that
// project's `face-viseme-N.png` sprite slots. The product is English-focused: English is keyed
// to those visemes via ARPAbet (CMUdict — Stage 2), diphthongs expanding to a viseme sequence
// (MAS does this: eɪ→[14,16]); Korean maps in via plain Unicode jamo arithmetic. We add the
// timing MAS lacked. See docs/superpowers/specs/2026-06-25-visemes-design.md.

export type Viseme = number // 0..18 (MAS face-viseme-N)

// The 19 visemes, in MAS order, with a procedural { open: vertical radius, width: horizontal
// radius }. A her-style sprite atlas (face-viseme-0..18) replaces these later — same indices.
export const VISEME_LABEL: string[] = [
  'sil', 'h', 'r', 'l', 's/z', 'sh', 'th(ð)', 'f/v', 't/d/n', 'k/g',
  'p/b/m', 'æ/ʌ/ə', 'ɑ/ah', 'ɔ/aw', 'ɛ/mid', 'ɝ/er', 'i/ee', 'u/oo', 'o/oh',
]
export const VISEME_SHAPE: { open: number; width: number }[] = [
  { open: 0.06, width: 1.0 }, // 0  sil — rest
  { open: 0.35, width: 1.0 }, // 1  h — breath, open-ish
  { open: 0.3, width: 0.85 }, // 2  r (ɹ) — slight round
  { open: 0.25, width: 1.0 }, // 3  l — tongue tip
  { open: 0.16, width: 1.05 }, // 4  s z — narrow teeth
  { open: 0.2, width: 0.8 }, // 5  sh (ʃ ʒ) — rounded forward
  { open: 0.2, width: 1.05 }, // 6  th (ð) — tongue to teeth
  { open: 0.12, width: 1.0 }, // 7  f v — lip to teeth
  { open: 0.24, width: 1.0 }, // 8  t d n θ ch j — alveolar
  { open: 0.4, width: 1.0 }, // 9  k g ŋ — back, open-ish
  { open: 0.0, width: 1.0 }, // 10 p b m — lips closed
  { open: 0.65, width: 1.1 }, // 11 æ ʌ ə — open central
  { open: 1.0, width: 1.0 }, // 12 ɑ aɪ aʊ — open wide
  { open: 0.7, width: 0.72 }, // 13 ɔ — open round
  { open: 0.5, width: 1.1 }, // 14 ɛ ʊ eɪ oʊ — mid
  { open: 0.35, width: 0.9 }, // 15 ɝ — r-colored mid
  { open: 0.3, width: 1.32 }, // 16 i ɪ j — front, spread
  { open: 0.45, width: 0.5 }, // 17 u w — high back round
  { open: 0.55, width: 0.68 }, // 18 o oʊ — back round
]

export type VisemeEvent = { viseme: Viseme; charIdx: number; tStart: number; tEnd: number } // ms

// Base durations (ms) at rate 1.0; divided by `rate` (rate>1 = faster speech).
const DUR = { vowel: 135, cons: 70, latin: 80, space: 110, comma: 150, stop: 300 }

// ── Korean (jamo Unicode decomposition) → MAS visemes ───────────────────────────────────────
const HANGUL_BASE = 0xac00
const HANGUL_LAST = 0xd7a3
// Medial vowel (jung, 0..20): ㅏㅐㅑㅒㅓㅔㅕㅖ ㅗㅘㅙㅚㅛ ㅜㅝㅞㅟㅠ ㅡㅢ ㅣ
const JUNG: number[] = [
  12, 14, 12, 14, 11, 14, 11, 14, // ㅏㅐㅑㅒㅓㅔㅕㅖ
  18, 12, 14, 14, 18, // ㅗㅘㅙㅚㅛ
  17, 11, 14, 16, 17, // ㅜㅝㅞㅟㅠ
  16, 16, // ㅡㅢ
  16, // ㅣ
]
// Initial consonant (cho, 0..18): ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ ( ㅇ = silent → -1 )
const CHO: number[] = [9, 9, 8, 8, 8, 3, 10, 10, 10, 4, 4, -1, 8, 8, 8, 9, 8, 10, 1]
// Final consonant (jong, 0..27; 0 = none), neutralized to the 7 Korean batchim → MAS visemes.
const JONG: number[] = [
  -1, 9, 9, 9, 8, 8, 8, 8, 3, 9, 10, 10, 3, 3, 10, 3, 10, 10, 10, 8, 8, 9, 8, 8, 9, 8, 10, 8,
]

// ── English crude per-letter fallback (until CMUdict/ARPAbet lands — Stage 2) ────────────────
const LATIN: Record<string, number> = {
  a: 12, e: 14, i: 16, o: 18, u: 17, y: 16,
  m: 10, b: 10, p: 10, f: 7, v: 7, w: 17,
  t: 8, d: 8, n: 8, l: 3, r: 2,
  k: 9, g: 9, c: 9, h: 1, q: 9, x: 9,
  s: 4, z: 4, j: 8,
}

// The viseme(s) one character maps to, with base (rate-1) durations in ms. Shared by the
// estimated-timing path (textToSchedule) and the audio-aligned path (scheduleFromAlignment),
// so the decomposition lives in one place. (Accurate English = CMUdict phonemes, Stage 2.)
function charVisemes(ch: string): { viseme: number; dur: number }[] {
  const code = ch.codePointAt(0)
  if (code === undefined) return []
  if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
    const idx = code - HANGUL_BASE
    const cho = CHO[Math.floor(idx / 588)]
    const jung = JUNG[Math.floor((idx % 588) / 28)] ?? 12
    const jong = JONG[idx % 28]
    const out: { viseme: number; dur: number }[] = []
    if (cho >= 0) out.push({ viseme: cho, dur: DUR.cons })
    out.push({ viseme: jung, dur: DUR.vowel })
    if (jong >= 0) out.push({ viseme: jong, dur: DUR.cons })
    return out
  }
  if (/[a-zA-Z]/.test(ch)) return [{ viseme: LATIN[ch.toLowerCase()] ?? 8, dur: DUR.latin }]
  if (ch === ' ' || ch === '\n' || ch === '\t') return [{ viseme: 0, dur: DUR.space }]
  if (ch === ',' || ch === '、') return [{ viseme: 0, dur: DUR.comma }]
  if ('.?!…。'.includes(ch)) return [{ viseme: 0, dur: DUR.stop }]
  return [] // other punctuation: no time
}

// Build the viseme schedule for `text` with ESTIMATED timing (the no-audio path). `rate`
// scales speed (1 = base). Coarticulation (cross-fade, sub-40ms drop) is applied at sample
// time by sampleShape(), so the with-audio path can rescale timing cleanly.
export function textToSchedule(text: string, rate = 1): VisemeEvent[] {
  const ev: VisemeEvent[] = []
  let t = 0
  for (let i = 0; i < text.length; i++) {
    for (const { viseme, dur } of charVisemes(text[i])) {
      const d = dur / rate
      ev.push({ viseme, charIdx: i, tStart: t, tEnd: t + d })
      t += d
    }
  }
  return ev
}

// ElevenLabs /with-timestamps alignment: parallel arrays, one entry per spoken character.
export type Alignment = {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

// Build the schedule on the REAL audio timing (the with-audio path): run the per-character
// viseme logic over alignment.characters and place each char's viseme(s) inside that char's
// [start,end] window (split by base durations). Sidesteps any source/synth index mapping — the
// timed units ARE the anchors. Zero drift. Falls back to [] if alignment is empty.
export function scheduleFromAlignment(a: Alignment | null | undefined): VisemeEvent[] {
  if (!a || !a.characters?.length) return []
  const ev: VisemeEvent[] = []
  for (let i = 0; i < a.characters.length; i++) {
    const start = (a.character_start_times_seconds[i] ?? 0) * 1000
    const end = (a.character_end_times_seconds[i] ?? start) * 1000
    const vs = charVisemes(a.characters[i])
    if (!vs.length) continue
    const total = vs.reduce((s, v) => s + v.dur, 0) || 1
    let t = start
    for (const { viseme, dur } of vs) {
      const d = ((end - start) * dur) / total
      ev.push({ viseme, charIdx: i, tStart: t, tEnd: t + d })
      t += d
    }
  }
  return ev
}

export function scheduleDuration(ev: VisemeEvent[]): number {
  return ev.length ? ev[ev.length - 1].tEnd : 0
}

// Anime-style JAW lip-sync (the Silly Crocodile / Corey Williams approach): forget phonemes,
// just open the jaw by `open` (0..1, from audio amplitude). A short ladder of mouth shapes —
// closed → slightly → mid → wide — is enough and reads better than per-phoneme detail. We blend
// between adjacent rungs (smoother than hard hide/unhide). JAW lists atlas cell ids low→high.
const JAW = [0, 1, 2, 3] // Monet's painted jaw ladder: closed · 30% · 60% · wide (mouth-atlas cells)
export function jawViseme(open: number): { a: number; b: number; blend: number } {
  const f = Math.min(1, Math.max(0, open)) * (JAW.length - 1)
  const i = Math.floor(f)
  return { a: JAW[i], b: JAW[Math.min(i + 1, JAW.length - 1)], blend: f - i }
}

// Sample the active viseme ids at time `tMs` for SPRITE rendering: the current viseme `a`, the
// next `b`, and a cross-fade `blend` 0..1 over the last `blendMs` of the current event (so the
// shader can dissolve atlas cell a → b). Before/after the schedule → viseme 0 (rest).
export function sampleViseme(ev: VisemeEvent[], tMs: number, blendMs = 60): { a: number; b: number; blend: number } {
  if (!ev.length) return { a: 0, b: 0, blend: 0 }
  let i = -1
  for (let k = 0; k < ev.length; k++) {
    if (ev[k].tStart <= tMs) i = k
    else break
  }
  if (i < 0) return { a: 0, b: 0, blend: 0 }
  const cur = ev[i]
  if (tMs >= cur.tEnd) {
    if (i === ev.length - 1) return { a: 0, b: 0, blend: 0 }
    return { a: cur.viseme, b: cur.viseme, blend: 0 }
  }
  const next = ev[i + 1]
  const into = cur.tEnd - tMs
  if (next && into < blendMs) return { a: cur.viseme, b: next.viseme, blend: 1 - into / blendMs }
  return { a: cur.viseme, b: cur.viseme, blend: 0 }
}

// Sample the mouth shape at time `tMs`, with coarticulation: cross-fade into the next viseme
// over the last `blendMs`. Returns the rest (sil) shape before/after the schedule. This is what
// the renderer reads each frame (active viseme → {open,width}).
export function sampleShape(ev: VisemeEvent[], tMs: number, blendMs = 60): { open: number; width: number } {
  if (!ev.length) return VISEME_SHAPE[0]
  let i = -1
  for (let k = 0; k < ev.length; k++) {
    if (ev[k].tStart <= tMs) i = k
    else break
  }
  if (i < 0) return VISEME_SHAPE[0]
  const cur = ev[i]
  const a = VISEME_SHAPE[cur.viseme] ?? VISEME_SHAPE[0]
  if (tMs >= cur.tEnd) {
    if (i === ev.length - 1) return VISEME_SHAPE[0]
    return a
  }
  const next = ev[i + 1]
  const into = cur.tEnd - tMs
  if (next && into < blendMs) {
    const f = 1 - into / blendMs
    const b = VISEME_SHAPE[next.viseme] ?? VISEME_SHAPE[0]
    return { open: a.open + (b.open - a.open) * f, width: a.width + (b.width - a.width) * f }
  }
  return a
}
