// Her voice — fetch /api/tts (ElevenLabs mp3), loudness-normalize, play. Used only
// when the room is un-muted. onStart fires when audio truly begins so the caption
// syncs with the sound. Ported from anima v34's voice.js serverSpeak.

let ctx: AudioContext | null = null
let curSrc: AudioBufferSourceNode | null = null
const TARGET_RMS = 0.09 // common loudness target (ElevenLabs doesn't level across voices)

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

// Speak `text`; resolves when playback ends (or immediately if it can't play).
export async function speak(text: string, onStart?: () => void): Promise<void> {
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
  const bytes = await r.arrayBuffer()
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
      a.onplay = () => onStart?.()
      a.onended = done
      a.onerror = done
      a.play().catch(done)
    })
    return
  }
  if (c.state === 'suspended') await c.resume().catch(() => {})
  let buf: AudioBuffer
  try {
    buf = await c.decodeAudioData(bytes.slice(0))
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
  src.connect(g).connect(c.destination)
  curSrc = src
  await new Promise<void>((resolve) => {
    src.onended = () => {
      if (curSrc === src) curSrc = null
      resolve()
    }
    src.start()
    onStart?.() // audio is now playing → caption is in sync
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
