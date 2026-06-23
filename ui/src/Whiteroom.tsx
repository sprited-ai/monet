import { useCallback, useEffect, useRef, useState } from 'react'
import { Renderer } from './scene/Renderer'
import type { Framing } from './scene/types'

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
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'speaking'>('idle')
  const [focused, setFocused] = useState(false)
  const [debug, setDebug] = useState(false)
  const [, force] = useState(0) // re-render the debug panel when sliders move

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoBoxRef = useRef<HTMLDivElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const framings = useRef<Record<string, Framing>>({})
  const indexed = useRef<Record<string, Indexed>>({})
  const script = useRef<string[]>([]) // queued clips (a reply's reaction + talk reps)
  const speaking = useRef(false)
  const lastIdle = useRef(-1)
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  const thinking = useRef(false)

  const framingFor = useCallback((name: string): Framing => {
    const key = indexed.current[name]?.framing ?? 'regular'
    return framings.current[key] ?? framings.current['regular'] ?? FALLBACK_FRAMING
  }, [])

  const clipMs = useCallback((name: string) => {
    const e = indexed.current[name]
    return e?.frames && e?.fps ? (e.frames / e.fps) * 1000 : 5000
  }, [])

  const play = useCallback(
    (name: string) => renderer.current?.character.setClip(clipSrc(name), framingFor(name)),
    [framingFor],
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

  // One clip finished → decide the next. Drains a reply's script, else idles.
  const advance = useCallback(() => {
    if (script.current.length > 0) {
      play(script.current.shift()!)
      return
    }
    if (speaking.current) {
      speaking.current = false
      setCaption(null)
      setPhase('idle')
    }
    play(pickAutonomous())
  }, [play, pickAutonomous])

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim()
      if (!msg || thinking.current) return
      thinking.current = true
      history.current.push({ role: 'user', content: msg })
      history.current = history.current.slice(-16)
      setPhase('thinking')
      let reply: { text: string; emotion: Emotion } = { text: '', emotion: 'calm' }
      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: history.current }),
        })
        const data = await r.json()
        reply = { text: (data.text || '').trim(), emotion: (data.emotion || 'calm') as Emotion }
      } catch {
        reply = { text: 'I can hear you, but my mind went quiet for a second.', emotion: 'calm' }
      }
      thinking.current = false
      if (!reply.text) reply.text = '…'
      history.current.push({ role: 'assistant', content: reply.text })

      const { reaction, talk } = REPLY_CLIPS[reply.emotion] ?? REPLY_CLIPS.calm
      const capMs = Math.max(2800, reply.text.split(/\s+/).length * 360)
      const reps = Math.max(1, Math.ceil(capMs / clipMs(talk)))
      script.current = [...(reaction ? [reaction] : []), ...Array(reps).fill(talk)]
      speaking.current = true
      setCaption(reply.text)
      setPhase('speaking')
      advance() // interrupt the idle clip and start reacting/speaking now
    },
    [advance, clipMs],
  )

  // Mount the scene; load framing geometry; greet on arrival.
  useEffect(() => {
    if (!canvasRef.current || !videoBoxRef.current) return
    const r = new Renderer(canvasRef.current, videoBoxRef.current)
    renderer.current = r
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

  // Backtick toggles the debug overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        setDebug((d) => !d)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const indicator = phase === 'thinking' ? '#e0a23c' : phase === 'speaking' ? '#c97a52' : 'transparent'

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
        type="text"
        autoComplete="off"
        placeholder="say something…"
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

      {debug && renderer.current && <DebugPanel r={renderer.current} onChange={() => force((n) => n + 1)} />}
    </div>
  )
}

// Backtick debug: toggle the embedded effects + nudge the camera, live.
function DebugPanel({ r, onChange }: { r: Renderer; onChange: () => void }) {
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
    </div>
  )
}
