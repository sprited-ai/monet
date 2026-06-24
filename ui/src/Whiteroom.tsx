import { useCallback, useEffect, useRef, useState } from 'react'
import { SpeakerLoudIcon, SpeakerOffIcon } from '@radix-ui/react-icons'
import { Renderer } from './scene/Renderer'
import { createRecognizer, resumeAudio, speak, stopSpeak, sttAvailable } from './voice'
import { getUid } from './uid'
import type { Framing, Mouth, Pose } from './scene/types'

// The white room — Monet's home (/). A real 3D scene (perspective camera) with
// Monet as a Ragnarok-style billboarded stacked-alpha sprite, in an empty gradient
// void (docs/016). This component is the *director*: it owns the idle-dominant FSM
// and the conversation loop, and drives the scene's CharacterNode. The scene
// (src/scene) is the *body/world*: pure rendering. See docs/015 for the why.

type Indexed = { framing?: string; fps?: number; frames?: number }
type Emotion = 'calm' | 'curious' | 'happy' | 'excited' | 'playful' | 'magic' | 'sad'

const clipSrc = (name: string) => `/contents/monet/${name}.mp4`

// She mostly just *is* (breathing idle); now and then a small cozy thing.
const IDLE_CLIPS = ['monet-idle-1', 'monet-idle-2', 'monet-idle-3']
const COZY_ACTIONS = [
  'monet-light-dance-1',
  'monet-cast-magic-2',
  'monet-flower-magic-1',
  'monet-happy-2',
  'monet-sit-1',
  'monet-drink-water-1',
  'monet-eat-bread',
  'monet-dust',
  'monet-paint-large-1',
  'monet-chill-large-1',
  'monet-wakes-up-1',
]

// A reply's emotion → an optional one-shot reaction + the talk clip she loops while
// the caption is up. (Only clips that exist in contents/monet/.)
const REPLY_CLIPS: Record<Emotion, { reaction?: string; talk: string }> = {
  calm: { talk: 'monet-talk-2' },
  curious: { talk: 'monet-talk-2' },
  happy: { reaction: 'monet-happy-1', talk: 'monet-talk-happy-large-1' },
  excited: { reaction: 'monet-happy-2', talk: 'monet-talk-happy-large-1' },
  playful: { reaction: 'monet-light-dance-1', talk: 'monet-talk-2' },
  magic: { reaction: 'monet-cast-magic-1', talk: 'monet-talk-2' },
  sad: { talk: 'monet-talk-sad-stuff-large-1' },
}

const FALLBACK_FRAMING: Framing = { frame: [1184, 1184], origin: [593, 1030], scale: 1 }

export default function Whiteroom() {
  const [caption, setCaption] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'speaking' | 'listening'>('idle')
  const [focused, setFocused] = useState(false)
  const [debug, setDebug] = useState(false)
  const [, force] = useState(0) // re-render the debug panel when sliders move
  // What Monet remembers about you — shown live in the debug overlay. Baseline fetched
  // when the panel opens; each reply appends the facts it just stored (no racy re-read).
  const [memory, setMemory] = useState<{ turns: number; memories: string[] } | null>(null)
  // Voice is opt-in: muted by default (no autoplay, no surprise ElevenLabs spend).
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('monet.muted') !== '0'
    } catch {
      return true
    }
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoBoxRef = useRef<HTMLDivElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const framings = useRef<Record<string, Framing>>({})
  const indexed = useRef<Record<string, Indexed>>({})
  const poseCache = useRef<Record<string, Promise<Pose | null>>>({}) // per-clip pose JSON, fetched once
  const mouthCache = useRef<Record<string, Promise<Mouth | null>>>({}) // per-clip mouth JSON, fetched once
  const script = useRef<string[]>([]) // queued clips (a reply's reaction + talk reps)
  const speaking = useRef(false)
  const lastIdle = useRef(-1)
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  const thinking = useRef(false)
  const talkClip = useRef('monet-talk-2') // the clip she loops while speaking
  const speakTimer = useRef(0) // muted: ends speaking after a read-time estimate
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const inputRef = useRef<HTMLInputElement>(null) // shows your live transcript while talking
  const recognizer = useRef<ReturnType<typeof createRecognizer>>(null)
  const listening = useRef(false)

  const framingFor = useCallback((name: string): Framing => {
    const key = indexed.current[name]?.framing ?? 'regular'
    return framings.current[key] ?? framings.current['regular'] ?? FALLBACK_FRAMING
  }, [])

  // Each clip's pose JSON, fetched once and cached (clips loop, so this pays off fast).
  // Missing data → null, and the shadow simply recenters under the feet.
  const poseFor = useCallback((name: string): Promise<Pose | null> => {
    if (!poseCache.current[name]) {
      poseCache.current[name] = fetch(`/contents/monet/${name}.pose.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Pose>) : null))
        .catch(() => null)
    }
    return poseCache.current[name]
  }, [])

  // Each clip's mouth JSON (SAM3 track), fetched once and cached. Missing → null, and
  // the mouth simply isn't erased (the clip plays untouched).
  const mouthFor = useCallback((name: string): Promise<Mouth | null> => {
    if (!mouthCache.current[name]) {
      mouthCache.current[name] = fetch(`/contents/monet/${name}.mouth.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Mouth>) : null))
        .catch(() => null)
    }
    return mouthCache.current[name]
  }, [])

  const play = useCallback(
    (name: string) =>
      renderer.current?.character.setClip(clipSrc(name), framingFor(name), poseFor(name), mouthFor(name)),
    [framingFor, poseFor, mouthFor],
  )

  const pickAutonomous = useCallback(() => {
    if (Math.random() < 0.72) {
      let i = Math.floor(Math.random() * IDLE_CLIPS.length)
      if (i === lastIdle.current) i = (i + 1) % IDLE_CLIPS.length
      lastIdle.current = i
      return IDLE_CLIPS[i]
    }
    return COZY_ACTIONS[Math.floor(Math.random() * COZY_ACTIONS.length)]
  }, [])

  // One clip finished → decide the next. Plays a reply's queued reaction, loops the
  // talk clip while she's still speaking, else returns to the autonomous idle loop.
  const advance = useCallback(() => {
    if (script.current.length > 0) {
      play(script.current.shift()!)
      return
    }
    if (speaking.current) {
      play(talkClip.current) // keep talking until the audio (or read-timer) ends
      return
    }
    play(pickAutonomous())
  }, [play, pickAutonomous])

  // Speaking is over (audio finished, or the muted read-timer elapsed) → back to idle.
  const endSpeaking = useCallback(() => {
    if (!speaking.current) return
    speaking.current = false
    window.clearTimeout(speakTimer.current)
    setCaption(null)
    setPhase('idle')
    play(pickAutonomous())
  }, [play, pickAutonomous])

  // Pull the current memory baseline (called when the debug panel opens).
  const refreshMemory = useCallback(() => {
    fetch('/api/memory', { headers: { 'x-monet-uid': getUid() } })
      .then((r) => r.json())
      .then((m) => setMemory(m))
      .catch(() => {})
  }, [])

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim()
      if (!msg || thinking.current) return
      stopSpeak() // barge-in: hush any reply in progress
      window.clearTimeout(speakTimer.current)
      thinking.current = true
      history.current.push({ role: 'user', content: msg })
      history.current = history.current.slice(-16)
      setPhase('thinking')
      let reply: { text: string; emotion: Emotion } = { text: '', emotion: 'calm' }
      let stored: string[] = []
      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-monet-uid': getUid() },
          body: JSON.stringify({ messages: history.current }),
        })
        const data = await r.json()
        reply = { text: (data.text || '').trim(), emotion: (data.emotion || 'calm') as Emotion }
        if (Array.isArray(data.stored)) stored = data.stored
      } catch (e) {
        // transparent error, not a fake in-character line
        reply = { text: `⚠ network error — ${e instanceof Error ? e.message : 'fetch failed'}`, emotion: 'calm' }
      }
      thinking.current = false
      if (!reply.text) reply.text = '⚠ empty reply'
      history.current.push({ role: 'assistant', content: reply.text })
      // Live memory: every reply is a turn (+1); append anything she just remembered.
      // Only while the panel has a baseline (memory != null) — re-opening re-syncs.
      setMemory((m) => (m ? { turns: m.turns + 1, memories: stored.length ? [...m.memories, ...stored] : m.memories } : m))

      const { reaction, talk } = REPLY_CLIPS[reply.emotion] ?? REPLY_CLIPS.calm
      talkClip.current = talk
      speaking.current = true
      setCaption(reply.text)
      setPhase('speaking')
      script.current = reaction ? [reaction] : [] // a one-shot reaction, then advance() loops `talk`
      advance() // interrupt the idle clip and start reacting/speaking now

      if (mutedRef.current) {
        // silent: hold the caption + talk loop for an estimated read time
        const capMs = Math.max(2800, reply.text.split(/\s+/).length * 360)
        speakTimer.current = window.setTimeout(endSpeaking, capMs)
      } else {
        // voiced: talk until the audio finishes
        speak(reply.text).finally(endSpeaking)
      }
    },
    [advance, endSpeaking],
  )

  // Push-to-talk: hold Space to talk. Her voice hushes (barge-in), your live
  // transcript appears in the text box, release sends it. Chrome-only (Web Speech).
  const startListening = useCallback(() => {
    if (!sttAvailable || listening.current || thinking.current) return
    listening.current = true
    stopSpeak() // hush her if she was mid-reply
    resumeAudio() // the keypress is a user gesture → unlock audio for her answer
    speaking.current = false
    window.clearTimeout(speakTimer.current)
    setCaption(null)
    setPhase('listening')
    const rec = createRecognizer({
      lang: 'ko-KR',
      onPartial: (t) => {
        if (inputRef.current) inputRef.current.value = t
      },
    })
    recognizer.current = rec
    rec?.start()
  }, [])

  const stopListening = useCallback(async () => {
    if (!listening.current) return
    listening.current = false
    const rec = recognizer.current
    recognizer.current = null
    const text = rec ? await rec.stop() : ''
    if (inputRef.current) inputRef.current.value = ''
    if (text.trim()) send(text)
    else setPhase('idle')
  }, [send])

  // Mount the scene; load framing geometry; greet on arrival.
  useEffect(() => {
    if (!canvasRef.current || !videoBoxRef.current) return
    const r = new Renderer(canvasRef.current, videoBoxRef.current)
    renderer.current = r
    if (import.meta.env.DEV) (window as unknown as { renderer: Renderer }).renderer = r // dev debug hook
    r.character.onClipEnd = advance
    r.start()
    let cancelled = false
    Promise.all([
      fetch('/contents/framings.json').then((x) => x.json()).catch(() => ({ framings: {} })),
      fetch('/contents/index.json').then((x) => x.json()).catch(() => ({ items: {} })),
    ]).then(([fr, idx]) => {
      if (cancelled) return
      framings.current = fr.framings ?? {}
      indexed.current = idx.items ?? {}
      play('monet-greet-1') // her first breath in the room
    })
    return () => {
      cancelled = true
      r.dispose()
      renderer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mouse wheel dollies the camera in/out on Monet (scroll up = closer).
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Trackpad pinch arrives as ctrl+wheel with tiny deltas → needs a much larger
      // gain than a mouse wheel (big deltas) to feel responsive.
      const k = e.ctrlKey ? 0.02 : 0.0016
      renderer.current?.zoomBy(Math.exp(-e.deltaY * k))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Backtick toggles the debug overlay. A reserved hotkey — works even while the
  // chat box is focused (preventDefault keeps the `\`` out of the input), since the
  // input is the primary surface and the old "not on INPUT" guard just swallowed it.
  // Match on e.code (physical key), not e.key: under a Korean/CJK IME the keydown
  // arrives as key:'Process' (keyCode 229) and `e.key === '`'` never matches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote' || e.key === '`') {
        e.preventDefault()
        setDebug((d) => !d)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Hold Space to talk (ignored while typing in the box).
  useEffect(() => {
    const typing = () => {
      const t = document.activeElement?.tagName
      return t === 'INPUT' || t === 'TEXTAREA'
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing()) {
        e.preventDefault()
        startListening()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && listening.current) {
        e.preventDefault()
        stopListening()
      }
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [startListening, stopListening])

  const indicator =
    phase === 'listening'
      ? '#4a78dc'
      : phase === 'thinking'
        ? '#e0a23c'
        : phase === 'speaking'
          ? '#c97a52'
          : 'transparent'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#eef2f7', // matches the gradient base — no flash before WebGL paints
        fontFamily: 'ui-rounded, "Avenir Next", system-ui, sans-serif',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      {/* hidden home for the sprite's <video> slots (kept in-tree so Safari decodes) */}
      <div ref={videoBoxRef} aria-hidden style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden' }} />

      {/* Caption — diegetic subtitle for what she says; fades with the words. */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: '13vh',
          textAlign: 'center',
          padding: '0 8vw',
          pointerEvents: 'none',
          color: 'rgba(86,60,48,0.96)',
          fontSize: 'clamp(16px, 2.5vh, 25px)',
          fontWeight: 500,
          lineHeight: 1.45,
          textShadow: '0 1px 12px rgba(255,255,255,0.8)',
          opacity: caption ? 1 : 0,
          transform: caption ? 'translateY(0)' : 'translateY(7px)',
          transition: 'opacity .28s ease, transform .28s ease',
        }}
      >
        {caption}
      </div>

      {/* The type box — faint at rest so the room shows through, bright on focus.
          IME-safe Enter (won't submit a half-composed Korean syllable). */}
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        placeholder={sttAvailable ? 'say something — or hold Space to talk' : 'say something…'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter') {
            const v = e.currentTarget.value
            e.currentTarget.value = ''
            send(v)
          } else if (e.key === 'Escape') {
            e.currentTarget.value = ''
            e.currentTarget.blur()
          }
        }}
        style={{
          position: 'fixed',
          left: '50%',
          bottom: '5vh',
          transform: 'translateX(-50%)',
          width: 'min(520px, 72vw)',
          padding: '11px 16px',
          borderRadius: 22,
          outline: 'none',
          textAlign: 'center',
          font: '15px ui-rounded, system-ui, sans-serif',
          color: 'rgba(40,46,58,0.95)',
          opacity: focused ? 1 : 0.4,
          background: focused ? 'rgba(255,255,255,0.92)' : 'transparent',
          border: `1px solid ${focused ? 'rgba(40,46,58,0.45)' : 'rgba(40,46,58,0.22)'}`,
          boxShadow: focused ? '0 4px 18px rgba(40,50,80,0.14)' : 'none',
          transition: 'opacity .2s ease, background .2s ease, border-color .2s ease, box-shadow .2s ease',
        }}
      />

      {/* Live indicator: amber while thinking, warm while speaking, invisible at rest. */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 11,
          height: 11,
          borderRadius: '50%',
          background: indicator,
          boxShadow: indicator === 'transparent' ? 'none' : `0 0 13px 3px ${indicator}`,
          transition: 'background .15s ease, box-shadow .15s ease',
        }}
      />

      {/* Mute toggle — voice only plays when un-muted (off by default). */}
      <button
        onClick={() =>
          setMuted((m) => {
            const next = !m
            try {
              localStorage.setItem('monet.muted', next ? '1' : '0')
            } catch {
              /* private mode — fine, just don't persist */
            }
            if (next) stopSpeak()
            else resumeAudio() // un-mute is a user gesture → unlock audio playback
            return next
          })
        }
        title={muted ? 'unmute her voice' : 'mute'}
        aria-label={muted ? 'unmute' : 'mute'}
        style={{
          position: 'fixed',
          top: 18,
          right: 18,
          width: 38,
          height: 38,
          borderRadius: 999,
          border: '1px solid rgba(40,46,58,0.16)',
          background: 'rgba(255,255,255,0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          color: muted ? 'rgba(120,110,104,0.85)' : 'rgba(201,122,82,0.95)',
          padding: 0,
        }}
      >
        {muted ? <SpeakerOffIcon width={18} height={18} /> : <SpeakerLoudIcon width={18} height={18} />}
      </button>

      {debug && renderer.current && (
        <DebugPanel r={renderer.current} onChange={() => force((n) => n + 1)} memory={memory} onRefresh={refreshMemory} />
      )}
    </div>
  )
}

// Backtick debug: toggle the embedded effects + nudge the camera, live, and show
// what Monet remembers about you (fetched fresh each time the panel opens).
function DebugPanel({
  r,
  onChange,
  memory,
  onRefresh,
}: {
  r: Renderer
  onChange: () => void
  memory: { turns: number; memories: string[] } | null
  onRefresh: () => void
}) {
  useEffect(() => {
    onRefresh()
  }, [onRefresh]) // sync the baseline when the panel opens; replies keep it live after
  const row = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
      <span>{label}</span>
      {node}
    </label>
  )
  const toggle = (key: 'shadow' | 'vignette' | 'grain') =>
    row(
      key,
      <input
        type="checkbox"
        checked={r.toggles[key]}
        onChange={(e) => {
          r.toggles[key] = e.target.checked
          onChange()
        }}
      />,
    )
  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) =>
    row(
      `${label} ${value.toFixed(2)}`,
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          set(parseFloat(e.target.value))
          onChange()
        }}
      />,
    )
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        width: 230,
        padding: '12px 14px',
        background: 'rgba(16,20,30,0.82)',
        color: 'rgba(228,232,240,0.95)',
        borderRadius: 12,
        font: '12px ui-monospace, monospace',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        zIndex: 99,
      }}
    >
      <div style={{ opacity: 0.6, marginBottom: 2 }}>` debug — white room</div>
      {toggle('shadow')}
      {toggle('vignette')}
      {toggle('grain')}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />
      {slider('fov', r.cam.fov, 18, 60, 0.5, (v) => (r.cam.fov = v))}
      {slider('eye y', r.cam.eye[1], 0, 3, 0.05, (v) => (r.cam.eye[1] = v))}
      {slider('eye z', r.cam.eye[2], 2, 9, 0.05, (v) => (r.cam.eye[2] = v))}
      {slider('look y', r.cam.target[1], 0, 2.5, 0.05, (v) => (r.cam.target[1] = v))}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />
      <div style={{ opacity: 0.6 }}>memory{memory ? ` · ${memory.turns} turns` : ' …'}</div>
      {memory && memory.memories.length === 0 && <div style={{ opacity: 0.5 }}>(nothing yet — talk to her)</div>}
      {memory?.memories.map((m, i) => (
        <div key={i} style={{ opacity: 0.85, lineHeight: 1.35 }}>
          • {m}
        </div>
      ))}
    </div>
  )
}
