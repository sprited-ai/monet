// Her voice — fetch /api/tts (ElevenLabs mp3), loudness-normalize, play. Used only
// when the room is un-muted. onStart fires when audio truly begins so the caption
// syncs with the sound. Ported from anima v34's voice.js serverSpeak.

import type { Alignment } from './viseme'

let ctx: AudioContext | null = null
let curSrc: AudioBufferSourceNode | null = null
const TARGET_RMS = 0.09 // common loudness target (ElevenLabs doesn't level across voices)

// base64 (ElevenLabs audio_base64) → bytes for decodeAudioData / a Blob.
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

// Lip-sync tap: an AnalyserNode spliced into the TTS graph so the mouth can read how loud
// she's speaking right now. See docs/superpowers/specs/2026-06-25-lip-sync-design.md.
let analyser: AnalyserNode | null = null
let tdBuf: Float32Array | null = null
let openSmoothed = 0

function getAnalyser(c: AudioContext): AnalyserNode {
  if (!analyser) {
    analyser = c.createAnalyser()
    analyser.fftSize = 1024
    tdBuf = new Float32Array(analyser.fftSize)
    analyser.connect(c.destination) // analyser → speakers, connected once
  }
  return analyser
}

// Current lip-sync openness (0..1) from the TTS audio being played. 0 when silent or when
// there's no Web Audio. Called once per render frame by CharacterNode.mouthOpenSource. EMA-
// smoothed, opening faster than it closes so speech reads natural.
export function mouthOpen(): number {
  if (!analyser || !tdBuf) return 0
  analyser.getFloatTimeDomainData(tdBuf)
  let sum = 0
  for (let i = 0; i < tdBuf.length; i++) sum += tdBuf[i] * tdBuf[i]
  const rms = Math.sqrt(sum / tdBuf.length)
  const FLOOR = 0.01, RANGE = 0.18
  const target = Math.min(1, Math.max(0, (rms - FLOOR) / RANGE))
  const k = target > openSmoothed ? 0.5 : 0.2
  openSmoothed += (target - openSmoothed) * k
  return openSmoothed
}

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  ctx = AC ? new AC() : null
  return ctx
}

// Call from a user gesture (the un-mute click) so the AudioContext is allowed to play.
export function resumeAudio() {
  const c = getCtx()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}

export function stopSpeak() {
  if (curSrc) {
    try {
      curSrc.stop()
    } catch {
      /* already stopped */
    }
    curSrc = null
  }
}

// Speak `text`; resolves when playback ends (or immediately if it can't play). onStart fires
// when audio truly begins, carrying ElevenLabs' character-timestamp alignment (or null) so the
// caller can lip-sync the viseme schedule to the real sound. /api/tts now returns JSON
// { audio: base64 mp3, alignment }.
export async function speak(text: string, onStart?: (alignment?: Alignment | null) => void): Promise<void> {
  stopSpeak()
  let r: Response
  try {
    r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch {
    return
  }
  if (!r.ok) return
  let payload: { audio?: string; alignment?: Alignment | null }
  try {
    payload = (await r.json()) as { audio?: string; alignment?: Alignment | null }
  } catch {
    return
  }
  if (!payload.audio) return
  const bytes = base64ToBytes(payload.audio)
  const alignment = payload.alignment ?? null
  const c = getCtx()
  if (!c) {
    // No Web Audio → plain <audio>, no normalization.
    await new Promise<void>((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
      const a = new Audio(url)
      const done = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      a.onplay = () => onStart?.(alignment)
      a.onended = done
      a.onerror = done
      a.play().catch(done)
    })
    return
  }
  if (c.state === 'suspended') await c.resume().catch(() => {})
  let buf: AudioBuffer
  try {
    buf = await c.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer)
  } catch {
    return
  }
  // Loudness-normalize: bring every clip toward TARGET_RMS, with a peak ceiling so it never clips.
  const ch = buf.getChannelData(0)
  let sum = 0
  let peak = 0
  for (let i = 0; i < ch.length; i++) {
    const v = ch[i]
    sum += v * v
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
  }
  const rms = Math.sqrt(sum / ch.length) || 0.0001
  let gain = Math.min(TARGET_RMS / rms, 4)
  if (peak * gain > 0.97) gain = 0.97 / (peak || 1)
  const src = c.createBufferSource()
  src.buffer = buf
  const g = c.createGain()
  g.gain.value = gain
  src.connect(g).connect(getAnalyser(c)) // g → analyser → destination (mouthOpen taps here)
  curSrc = src
  await new Promise<void>((resolve) => {
    src.onended = () => {
      if (curSrc === src) curSrc = null
      resolve()
    }
    src.start()
    onStart?.(alignment) // audio is now playing → caption + visemes in sync
  })
}

// --- ears: push-to-talk speech recognition (Web Speech API, Chrome-only) ---
// Ported from anima v34. Hold a key → start(); release → stop() resolves the
// final transcript. onPartial streams the interim text while you speak.
type SR = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
const SRClass = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR })
  .SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition || null

export const sttAvailable = !!SRClass

export function createRecognizer(opts: { lang?: string; onPartial?: (t: string) => void }) {
  if (!SRClass) return null
  const rec = new SRClass()
  rec.lang = opts.lang || 'ko-KR' // handles mixed Korean/English; Jin speaks Korean
  rec.continuous = true // keep listening until we stop (push-to-talk)
  rec.interimResults = true
  let finalText = ''
  let running = false
  let resolveStop: ((t: string) => void) | null = null
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    opts.onPartial?.((finalText + ' ' + interim).trim())
  }
  rec.onerror = (e) => console.warn('[voice] stt', e.error)
  rec.onend = () => {
    running = false
    resolveStop?.(finalText.trim())
    resolveStop = null
  }
  return {
    start() {
      if (running) return
      finalText = ''
      running = true
      try {
        rec.start()
      } catch {
        running = false
      }
    },
    stop(): Promise<string> {
      if (!running) return Promise.resolve(finalText.trim())
      return new Promise<string>((res) => {
        resolveStop = res
        try {
          rec.stop()
        } catch {
          res(finalText.trim())
        }
      })
    },
  }
}

// --- hands-free ears (Approach A): Silero VAD → utterance audio → Whisper (/api/whisper) ---
// Always-listening, no push-to-talk. Silero (ricky0123/vad-web, lazy-loaded from CDN on first
// use) fires only on real speech; an energy gate drops the rare misfire. The utterance audio
// (Float32 @16k) goes to Groq Whisper for the clean KO+EN transcript — one model, OOV via the
// server prompt. Known gap: it can't tell you from a background TALKER (TV) — that needs a
// dictation-grade gate or speaker-ID (see /voice/b.html, docs). Works in any browser w/ mic.
type MicVADInstance = { start: () => void; pause: () => void }
type VadGlobal = { MicVAD: { new: (opts: Record<string, unknown>) => Promise<MicVADInstance> } }
const VAD_BASE = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/'
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/'
const MIN_RMS = 0.015 // captured-clip energy below this = not real speech → don't transcribe

let vadLoading: Promise<void> | null = null
function loadVad(): Promise<void> {
  if ((window as unknown as { vad?: VadGlobal }).vad?.MicVAD) return Promise.resolve()
  if (vadLoading) return vadLoading
  const addScript = (src: string) =>
    new Promise<void>((res, rej) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = () => res()
      s.onerror = () => rej(new Error('load ' + src))
      document.head.appendChild(s)
    })
  vadLoading = addScript(ORT_BASE + 'ort.wasm.min.js').then(() => addScript(VAD_BASE + 'bundle.min.js'))
  return vadLoading
}

function floatToWav(f32: Float32Array, rate: number): ArrayBuffer {
  const len = f32.length
  const ab = new ArrayBuffer(44 + len * 2)
  const dv = new DataView(ab)
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)) }
  w(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true)
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * 2, true)
  let off = 44
  for (let i = 0; i < len; i++) { const v = Math.max(-1, Math.min(1, f32[i])); dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true); off += 2 }
  return ab
}

export type HandsFree = {
  start: () => void
  pause: () => void
  resume: () => void
  destroy: () => void
  micLevel: () => number // 0..1 live mic loudness, for the "she's listening" visualization
}

// Build an always-listening recognizer. onTranscript fires with the clean Whisper text once a
// real utterance ends. pause()/resume() gate it for half-duplex (off while she speaks). Returns
// null if the VAD can't load or mic is denied.
export async function createHandsFree(opts: {
  onTranscript: (text: string) => void
  onSpeechStart?: () => void
}): Promise<HandsFree | null> {
  try {
    await loadVad()
  } catch (e) {
    console.warn('[voice] vad load failed', e)
    return null
  }
  const vad = (window as unknown as { vad?: VadGlobal }).vad
  if (!vad?.MicVAD) return null
  let gated = false // true = she's speaking → ignore input
  // Live mic loudness for the listening visualization. Updated every VAD frame from the exact
  // audio the recognizer hears (no separate getUserMedia). EMA-smoothed, speech-probability
  // lifted so real talking reads punchier than room noise. Decays to 0 while she's speaking.
  let level = 0
  let mic: MicVADInstance
  try {
    mic = await vad.MicVAD.new({
      baseAssetPath: VAD_BASE,
      onnxWASMBasePath: ORT_BASE,
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.4,
      minSpeechFrames: 4,
      preSpeechPadFrames: 4, // keep ~250ms before onset so the first syllable isn't clipped
      redemptionFrames: 12, // tolerate brief pauses so a sentence isn't cut mid-thought
      onFrameProcessed: (probs: { isSpeech?: number }, frame: Float32Array) => {
        if (gated) { level *= 0.85; return }
        let s = 0
        for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i]
        const rms = Math.sqrt(s / frame.length)
        // amplitude maps to 0..1; speech probability adds a floor so a detected voice clearly
        // blooms even when softly spoken, while ambient noise stays low.
        const amp = Math.min(1, rms / 0.12)
        const target = Math.min(1, Math.max(amp, (probs?.isSpeech ?? 0) * 0.55 * amp + amp * 0.45))
        level += (target - level) * (target > level ? 0.55 : 0.12) // open fast, fall slow
      },
      onSpeechStart: () => { if (!gated) opts.onSpeechStart?.() },
      onSpeechEnd: (audio: Float32Array) => {
        if (gated) return
        let s = 0
        for (let i = 0; i < audio.length; i++) s += audio[i] * audio[i]
        const energy = Math.sqrt(s / audio.length)
        if (audio.length < 16000 * 0.2 || energy < MIN_RMS) return // silence / faint noise / echo
        fetch('/api/whisper', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: floatToWav(audio, 16000) })
          .then((r) => r.json())
          .then((d) => { const t = (d.text || '').trim(); if (t) opts.onTranscript(t) })
          .catch(() => {})
      },
    })
  } catch (e) {
    console.warn('[voice] mic vad init failed', e)
    return null
  }
  return {
    start() { gated = false; mic.start() },
    pause() { gated = true; try { mic.pause() } catch { /* not running */ } },
    resume() { gated = false; mic.start() },
    destroy() { gated = true; try { mic.pause() } catch { /* not running */ } },
    micLevel() { return level },
  }
}
