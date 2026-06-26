import { useCallback, useEffect, useRef, useState } from 'react'
import { Renderer } from './scene/Renderer'
import { createHandsFree, resumeAudio, speak, stopSpeak, mouthOpen, type HandsFree } from './voice'
import { textToSchedule, scheduleFromAlignment, sampleShape, jawViseme, scheduleDuration, type VisemeEvent } from './viseme'
import { getUid } from './uid'
import type { Face, Framing, Mouth, Pose } from './scene/types'

// The white room — Monet's home (/). A real 3D scene (perspective camera) with
// Monet as a Ragnarok-style billboarded stacked-alpha sprite, in an empty gradient
// void (docs/016). This component is the *director*: it owns the idle-dominant FSM
// and the conversation loop, and drives the scene's CharacterNode. The scene
// (src/scene) is the *body/world*: pure rendering. See docs/015 for the why.

type Indexed = { framing?: string; fps?: number; frames?: number; mouthRig?: boolean | 'talk' }
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

// A plain vector mic (Radix has no microphone icon, and Jin doesn't want emoji).
function MicIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="8.5" y1="21" x2="15.5" y2="21" />
    </svg>
  )
}

// A plain × for leaving voice mode.
function XIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

export default function Whiteroom({ overlay = false }: { overlay?: boolean }) {
  // `overlay` (the /desktop route): the desktop overlay shell. The room dissolves to a transparent
  // canvas and the UI chrome hides so only Monet floats; clicking her silhouette toggles listening.
  // Purely additive — the default `/` route passes nothing, so this is the unchanged white room.
  // See apps/desktop.
  const [caption, setCaption] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'speaking' | 'listening'>('idle')
  const [focused, setFocused] = useState(false)
  const [debug, setDebug] = useState(false)
  const [, force] = useState(0) // re-render the debug panel when sliders move
  // What Monet remembers about you — shown live in the debug overlay. Baseline fetched
  // when the panel opens; each reply appends the facts it just stored (no racy re-read).
  const [memory, setMemory] = useState<{ turns: number; memories: string[] } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoBoxRef = useRef<HTMLDivElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const framings = useRef<Record<string, Framing>>({})
  const indexed = useRef<Record<string, Indexed>>({})
  const poseCache = useRef<Record<string, Promise<Pose | null>>>({}) // per-clip pose JSON, fetched once
  const mouthCache = useRef<Record<string, Promise<Mouth | null>>>({}) // per-clip mouth JSON, fetched once
  const faceCache = useRef<Record<string, Promise<Face | null>>>({}) // per-clip face JSON (mouth-tilt), fetched once
  const script = useRef<string[]>([]) // queued clips (a reply's reaction + talk reps)
  const speaking = useRef(false)
  const lastIdle = useRef(-1)
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  const thinking = useRef(false)
  const reacting = useRef(false) // a head-pat reaction owns the body (suppresses the idle FSM)
  const talkClip = useRef('monet-talk-2') // the clip she loops while speaking
  const lastClip = useRef('monet-idle-1') // the clip currently playing — kept looping while she speaks
  const speakTimer = useRef(0) // no-voice: ends speaking after a read-time estimate
  const visemeSched = useRef<VisemeEvent[]>([]) // current reply's text→viseme schedule
  const visemePlayStart = useRef(0) // performance.now() when the schedule started
  const captionVisemes = useRef(false) // muted path: shape+openness from the text schedule
  const voicedVisemes = useRef(false) // voiced path: shape from the audio-aligned schedule, openness × amplitude
  const inputRef = useRef<HTMLInputElement>(null) // the type box
  const handsFree = useRef<HandsFree | null>(null) // always-listening Silero+Whisper ears (Approach A)
  const [hfActive, setHfActive] = useState(false) // mic on/off (hands-free) — also the voice gate
  const hfActiveRef = useRef(false) // speakReply reads it imperatively (no stale closure)
  hfActiveRef.current = hfActive
  const [hfStarting, setHfStarting] = useState(false)
  const phaseRef = useRef(phase) // stable read of the turn state by the room mood source
  phaseRef.current = phase
  const vizColorRef = useRef('189,179,235') // current turn-state rgb, read each frame by the room aura

  // The live "level" that drives the room's mood aura, by turn: your turn → your mic loudness
  // (she's hearing you), her turn → her TTS amplitude (the room glows as she speaks — ambient,
  // behind her, so it deepens presence without pulling the gaze off her face), thinking → a faint
  // shimmer. The aura lives in the backdrop shader, not a UI widget, so it never breaks eye contact.
  const roomLevel = useCallback(() => {
    if (phaseRef.current === 'speaking') return mouthOpen()
    // Thinking is the moment the color matters most — make it the strongest, clearly-pulsing state
    // (a deep terracotta breath) so "she's processing" reads unmistakably, not as a faint shimmer.
    if (phaseRef.current === 'thinking') return 0.62 + 0.22 * Math.sin(performance.now() / 260)
    return handsFree.current?.micLevel() ?? 0 // listening / idle-while-mic-on
  }, [])

  const framingFor = useCallback((name: string): Framing => {
    const key = indexed.current[name]?.framing ?? 'regular'
    return framings.current[key] ?? framings.current['regular'] ?? FALLBACK_FRAMING
  }, [])

  // Each clip's pose JSON, fetched once and cached (clips loop, so this pays off fast).
  // Missing data → null, and the shadow simply recenters under the feet.
  const poseFor = useCallback((name: string): Promise<Pose | null> => {
    if (!poseCache.current[name]) {
      poseCache.current[name] = fetch(`/contents/monet/${name}.bizarre.json`)
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

  // Each clip's face JSON (28-pt landmarks); drives the rigged-mouth tilt. Missing → null,
  // and the composited mouth simply stays untilted (box-aligned).
  const faceFor = useCallback((name: string): Promise<Face | null> => {
    if (!faceCache.current[name]) {
      faceCache.current[name] = fetch(`/contents/monet/${name}.face.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Face>) : null))
        .catch(() => null)
    }
    return faceCache.current[name]
  }, [])

  // Only clips flagged `mouthRig` in index.json (the frontal-face talking clips) get the
  // rigged mouth — passing mouth/face data turns on the shader erase + composite. Every other
  // clip (idle, cozy, turns, jumps) plays 100% native: no data → no erase, no overlay. The
  // flag is hand-owned in contents/index.json (seeded by measure-contents.py, "talk" → true).
  const play = useCallback(
    (name: string) => {
      lastClip.current = name
      // mouthRig: true = always rig · 'talk' = native baked mouth, rig only while she speaks ·
      // false/absent = never. Load mouth/face data for on+talk; rigMode gates the live erase.
      const flag = indexed.current[name]?.mouthRig
      const rig = flag === true || flag === 'talk'
      const rigMode = flag === 'talk' ? 'talk' : flag === true ? 'on' : 'off'
      return renderer.current?.character.setClip(
        clipSrc(name),
        framingFor(name),
        poseFor(name),
        rig ? mouthFor(name) : null,
        rig ? faceFor(name) : null,
        { rigMode },
      )
    },
    [framingFor, poseFor, mouthFor, faceFor],
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
    if (reacting.current) return // a head-pat is playing; it resumes the loop via onReactionEnd
    if (script.current.length > 0) {
      play(script.current.shift()!)
      return
    }
    if (speaking.current) {
      play(lastClip.current) // keep the CURRENT animation looping while she speaks (no jump to a talk clip)
      return
    }
    play(pickAutonomous())
  }, [play, pickAutonomous])

  // Speaking is over (audio finished, or the muted read-timer elapsed) → back to idle.
  const endSpeaking = useCallback(() => {
    if (!speaking.current) return
    speaking.current = false
    captionVisemes.current = false
    voicedVisemes.current = false
    if (renderer.current) renderer.current.character.rigActive = false // back to native baked mouth
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

  // Drive her body to say a line: pick the emotion's clips, show the caption, and
  // hold the talk loop until the audio (or the muted read-timer) ends. Shared by a
  // reply (send) and the unprompted welcome-back greeting.
  const speakReply = useCallback(
    (reply: { text: string; emotion: Emotion }, opts?: { silent?: boolean }) => {
      const { reaction, talk } = REPLY_CLIPS[reply.emotion] ?? REPLY_CLIPS.calm
      talkClip.current = talk
      speaking.current = true
      // Lip-sync ONLY when she actually speaks aloud (voiced). A typed/muted conversation keeps
      // her NATIVE baked mouth — no jaw flapping over silent captions. rigActive turns on in the
      // voiced onStart below, off again in endSpeaking.
      if (renderer.current) renderer.current.character.rigActive = false
      // Build this reply's text→viseme schedule; the muted path drives the mouth from it.
      visemeSched.current = textToSchedule(reply.text)
      visemePlayStart.current = performance.now()
      captionVisemes.current = !!(opts?.silent || !hfActiveRef.current)
      voicedVisemes.current = false // set true when the audio's alignment arrives (onStart)
      setPhase('speaking')
      if (inputRef.current) inputRef.current.value = '' // clear the echoed transcript as she answers
      // Don't switch the animation when she starts talking — the lip-sync (rigActive) overlays on
      // whatever clip is already playing; it keeps looping (advance → lastClip). [reaction unused]
      void reaction
      const holdMuted = () => {
        // hold the caption + talk loop for an estimated read time, then idle
        const capMs = Math.max(2000, scheduleDuration(visemeSched.current) + 400)
        speakTimer.current = window.setTimeout(endSpeaking, capMs)
      }
      // `silent`: caption-only, no voice attempt. Used by the welcome-back greeting,
      // which fires on load BEFORE any user gesture — audio autoplay is blocked there,
      // so speak()'s AudioContext.resume() would hang and the (onStart-gated) caption
      // would never appear. Caption-only guarantees the greeting always shows.
      // Voice is gated on the mic: she only *speaks* in voice-conversation mode
      // (hands-free on). Typed chat with the mic off stays caption-only — no
      // surprise autoplay, no ElevenLabs spend until the user opts into talking.
      if (opts?.silent || !hfActiveRef.current) {
        setCaption(reply.text) // no voice → show the line right away
        holdMuted()
      } else {
        // Voiced: hold the caption until the audio actually starts (onStart), so the
        // line and the sound land together instead of the caption leading by the TTS
        // latency. If TTS never starts (error), fall back to the muted read-timer so
        // the line still shows.
        let started = false
        speak(reply.text, (alignment) => {
          started = true
          if (renderer.current) renderer.current.character.rigActive = true // voiced → rig the mouth for lip-sync
          setCaption(reply.text)
          // Align the viseme schedule to the real audio: shapes now match the sound (zero
          // drift). Openness is then modulated by live amplitude. No alignment → amplitude only.
          const aligned = scheduleFromAlignment(alignment)
          if (aligned.length) {
            visemeSched.current = aligned
            visemePlayStart.current = performance.now()
            voicedVisemes.current = true
          }
        }).then(() => {
          if (started) endSpeaking()
          else {
            // TTS failed → fall back to caption-only + text visemes so the mouth still moves.
            setCaption(reply.text)
            captionVisemes.current = true
            visemePlayStart.current = performance.now()
            holdMuted()
          }
        })
      }
    },
    [advance, endSpeaking],
  )

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
      // Overlay (desktop being): glance at what's on the person's screen, on-demand (only now, because
      // they're talking to her). Read locally on-device via the shell; only the extracted text is sent,
      // and a failure (no permission / not in the shell) just omits it. See apps/desktop.
      let screen: string | undefined
      const readScreen = (window as unknown as { __monetReadScreen?: () => Promise<{ ok: boolean; text?: string }> }).__monetReadScreen
      if (overlay && typeof readScreen === 'function') {
        try {
          const res = await readScreen()
          if (res?.ok && res.text) screen = res.text.slice(0, 2000)
        } catch {
          /* no permission / not available → just skip screen context */
        }
      }
      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-monet-uid': getUid() },
          body: JSON.stringify({ messages: history.current, ...(screen ? { screen } : {}) }),
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

      speakReply(reply)
    },
    [speakReply],
  )

  // Hands-free (Approach A): tap the mic → always-listening Silero VAD + Whisper. Each
  // finished utterance is transcribed and sent; no key to hold. Tap again to turn off.
  const toggleHandsFree = useCallback(async () => {
    if (handsFree.current) {
      handsFree.current.destroy()
      handsFree.current = null
      setHfActive(false)
      if (!speaking.current && !thinking.current) setPhase('idle')
      return
    }
    setHfStarting(true)
    resumeAudio() // the tap is a user gesture → unlock her voice + the mic
    const hf = await createHandsFree({
      onTranscript: (text) => {
        if (!text.trim()) return
        if (inputRef.current) inputRef.current.value = text // echo what she heard (catches OOV/mishears)
        send(text)
      },
    })
    setHfStarting(false)
    if (!hf) return // no VAD / mic denied
    handsFree.current = hf
    setHfActive(true)
    hf.start()
    if (!speaking.current && !thinking.current) setPhase('listening')
  }, [send])

  // Half-duplex: gate the ears off while she thinks/speaks (no echo, no self-trigger),
  // resume shortly after she's done. Driven by the conversation phase.
  useEffect(() => {
    const hf = handsFree.current
    if (!hf || !hfActive) return
    if (phase === 'thinking' || phase === 'speaking') {
      hf.pause()
    } else {
      const id = window.setTimeout(() => hf.resume(), 350)
      return () => window.clearTimeout(id)
    }
  }, [phase, hfActive])

  // Mount the scene; load framing geometry; greet on arrival.
  useEffect(() => {
    if (!canvasRef.current || !videoBoxRef.current) return
    const r = new Renderer(canvasRef.current, videoBoxRef.current, { overlay })
    renderer.current = r
    if (import.meta.env.DEV) (window as unknown as { renderer: Renderer }).renderer = r // dev debug hook
    // Overlay: let the desktop shell read Monet's alpha under the cursor (pixel-perfect click-through).
    if (overlay) (window as unknown as { __monetAlphaAt?: (x: number, y: number) => number }).__monetAlphaAt = (x, y) => r.alphaAt(x, y)
    // Lip-sync. Muted (caption-only) path: mouth SHAPE comes from the reply's text→viseme
    // schedule on estimated timing. Voiced path: amplitude drives openness (audio-synced
    // visemes are the /with-timestamps step). Both → 0/neutral when she isn't speaking.
    r.character.mouthOpenSource = () => {
      if (!speaking.current) return mouthOpen()
      const t = performance.now() - visemePlayStart.current
      if (captionVisemes.current) return sampleShape(visemeSched.current, t).open // muted: pure schedule
      // voiced + audio-aligned: viseme gives the target openness, live amplitude modulates it.
      if (voicedVisemes.current) return sampleShape(visemeSched.current, t).open * (0.45 + 0.55 * mouthOpen())
      return mouthOpen() // voiced, no alignment yet → amplitude only
    }
    r.character.mouthWideSource = () =>
      speaking.current && (captionVisemes.current || voicedVisemes.current)
        ? sampleShape(visemeSched.current, performance.now() - visemePlayStart.current).width
        : 1
    // The real mouth — anime JAW lip-sync (a few shapes by jaw-open, the Silly-Crocodile way):
    // drive the 4-shape jaw ladder (atlas cells 0..3) by OPENNESS, not phonemes (which would pick
    // empty atlas cells → the mouth vanishing). Muted = openness from the text schedule; voiced =
    // live TTS amplitude. Closed (rest) when she isn't speaking.
    r.character.mouthVisemeSource = () => {
      if (!speaking.current) return jawViseme(0)
      const open = captionVisemes.current
        ? sampleShape(visemeSched.current, performance.now() - visemePlayStart.current).open
        : mouthOpen()
      return jawViseme(open)
    }
    r.character.preloadHeadPat(clipSrc('monet-headpat-loop')) // prebake the head-pat loop now → instant on tap
    // Feed the room's mood aura the live turn state: its color (Monet's palette), level (by turn),
    // and whether voice mode is on. The backdrop shader renders it behind her — the conversation's
    // ambient visualization. Parsed from the same vizColorRef the UI uses, so they never diverge.
    r.room.moodSource = () => {
      const [cr, cg, cb] = vizColorRef.current.split(',')
      return {
        color: [+cr / 255, +cg / 255, +cb / 255],
        level: roomLevel(),
        active: hfActiveRef.current ? 1 : 0,
      }
    }
    r.character.onClipEnd = advance
    // A head-pat reaction finished (she's settled back) → resume the autonomous idle loop.
    r.character.onReactionEnd = () => {
      reacting.current = false
      play(pickAutonomous())
    }
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
      // Welcome-back: once she's awake, if she remembers this person she says a short
      // line referencing them — the memory moat, made felt (docs/015). Greets on every
      // arrival (each page load is an entry); the line varies, so it doesn't feel rote.
      // Caption-only (silent): the greeting precedes any user gesture, so audio can't
      // autoplay yet. Ambient — empty/error degrades to silence, never a ⚠. The
      // `cancelled` guard keeps React StrictMode's double-mount from double-greeting.
      fetch('/api/greeting', { headers: { 'x-monet-uid': getUid() } })
        .then((x) => x.json())
        .then((g) => {
          if (cancelled || !g?.text) return
          speakReply({ text: g.text, emotion: (g.emotion || 'calm') as Emotion }, { silent: true })
        })
        .catch(() => {})
    })
    return () => {
      cancelled = true
      r.dispose()
      renderer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dolly the camera in/out on Monet: mouse wheel / trackpad pinch (desktop) + two-finger
  // pinch (mobile — touch gestures don't fire `wheel`, so they need their own handler).
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
    let pinch = 0 // last two-finger distance while pinching (0 = not pinching)
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch = spread(e.touches) }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      e.preventDefault() // stop the browser's own page-zoom from hijacking the gesture
      const d = spread(e.touches)
      if (pinch > 0 && d > 0) renderer.current?.zoomBy(d / pinch) // spread apart = zoom in
      pinch = d
    }
    const endPinch = (e: TouchEvent) => { if (e.touches.length < 2) pinch = 0 }
    // iOS Safari fires gesture* for a pinch and runs its own page-zoom; preventDefault on these
    // (plus touch-action:none on the canvas) hands the gesture to our touchmove dolly instead.
    const stopGesture = (e: Event) => e.preventDefault()
    const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend']
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', endPinch)
    el.addEventListener('touchcancel', endPinch)
    for (const ev of gestureEvents) el.addEventListener(ev, stopGesture as EventListener, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', endPinch)
      el.removeEventListener('touchcancel', endPinch)
      for (const ev of gestureEvents) el.removeEventListener(ev, stopGesture as EventListener)
    }
  }, [])

  // Head-pat: a touch/click on her head plays the looping head-sway clip (she looks up and
  // sways happily); lifting off cross-dissolves her back to idle. Single-pointer; a second
  // finger (pinch-zoom) aborts the pat. Ignored while she's thinking/speaking (no clobbered reply).
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    let patId = -1 // pointerId currently petting her (-1 = none)
    let down = 0 // active pointer count (≥2 = a pinch, not a pat)
    const norm = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    }
    const onDown = (e: PointerEvent) => {
      down++
      if (down > 1) {
        if (patId !== -1) renderer.current?.character.release() // a 2nd finger → hand it to the pinch
        patId = -1
        return
      }
      if (patId !== -1 || thinking.current || speaking.current) return
      const head = renderer.current?.character.headScreenPos()
      if (!head) return
      const p = norm(e)
      if (Math.hypot(p.x - head.x, p.y - head.y) > head.r) return // not on her head
      patId = e.pointerId
      reacting.current = true
      renderer.current?.character.playReaction(clipSrc('monet-headpat-loop'), framingFor('monet-headpat-loop'), poseFor('monet-headpat-loop'))
    }
    const onUp = (e: PointerEvent) => {
      down = Math.max(0, down - 1)
      if (e.pointerId !== patId) return
      patId = -1
      renderer.current?.character.release() // lifted off → return to idle
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [framingFor, poseFor])

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

  // Tap Space to toggle hands-free listening (ignored while typing in the box).
  useEffect(() => {
    const typing = () => {
      const t = document.activeElement?.tagName
      return t === 'INPUT' || t === 'TEXTAREA'
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing()) {
        e.preventDefault()
        toggleHandsFree()
      }
    }
    window.addEventListener('keydown', onDown)
    return () => window.removeEventListener('keydown', onDown)
  }, [toggleHandsFree])

  // Turn-state color for the voice bar — in *Monet's own palette* (warm gold → terracotta → ruby),
  // not the /voice lab's blue/purple. A warm-hue progression the user learns by feel: gold = your
  // turn, terracotta = thinking, ruby (her dress) = her turn. CSS transitions smooth the cross-fade.
  // Turn palette (multiply-blended onto the void): one cohesive violet family. Your turn
  // (listening) = soft periwinkle-violet; her turn (speaking) = lavender; thinking = a deep dusty
  // plum-mauve leaning toward her ruby dress — the standout "processing" tone, distinguished by
  // depth, not a foreign hue. Tuned for multiply: too-light colors barely tint, so none are near-white.
  const turnRgb = phase === 'thinking' ? '122,84,117' : phase === 'speaking' ? '199,173,242' : '189,179,235'
  vizColorRef.current = turnRgb

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        // Overlay: transparent so the desktop shows through; otherwise the room base color.
        background: overlay ? 'transparent' : '#eef2f7', // matches the gradient base — no flash before WebGL paints
        fontFamily: 'ui-rounded, "Avenir Next", system-ui, sans-serif',
      }}
    >
      <style>{`@keyframes monet-think{0%,80%,100%{transform:translateY(0);opacity:.3}40%{transform:translateY(-5px);opacity:1}}#monet-say::placeholder{color:rgba(60,66,78,0.5)}`}</style>
      {/* Overlay: punch transparency all the way down through the Radix Theme + body, so only Monet paints. */}
      {overlay && <style>{`html,body,.radix-themes{background:transparent !important}`}</style>}
      <canvas
        ref={canvasRef}
        onClick={overlay ? () => toggleHandsFree() : undefined} // overlay: click her silhouette → toggle listening (mic)
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: overlay ? 'pointer' : undefined }}
      />
      {/* hidden home for the sprite's <video> slots (kept in-tree so Safari decodes) */}
      <div ref={videoBoxRef} aria-hidden style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden' }} />

      {/* Caption — a movie/video subtitle (YouTube/Netflix feel): white text on a soft
          dark scrim that hugs each line (box-decoration-break: clone), so it's crisply
          legible over the light void OR her sprite. The outer div positions + fades it. */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: '11vh',
          textAlign: 'center',
          padding: '0 6vw',
          pointerEvents: 'none',
          opacity: caption ? 1 : 0,
          transform: caption ? 'translateY(0)' : 'translateY(6px)',
          transition: 'opacity .25s ease, transform .25s ease',
        }}
      >
        <span
          style={{
            background: 'rgba(0,0,0,0.62)',
            color: 'rgba(255,255,255,0.98)',
            padding: '0.2em 0.5em',
            borderRadius: 7,
            fontFamily: 'system-ui, "Helvetica Neue", Arial, sans-serif',
            fontSize: 'clamp(17px, 2.7vh, 27px)',
            fontWeight: 600,
            lineHeight: 1.6,
            letterSpacing: '0.005em',
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
            WebkitBoxDecorationBreak: 'clone',
            boxDecorationBreak: 'clone',
          }}
        >
          {caption}
        </span>
      </div>

      {/* Thinking: a soft "•••" pulse where her caption will land — a subtle "she's composing"
          processing cue while /api/chat is in flight. Amber, matching the live indicator dot. */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: '11vh',
          display: 'flex',
          justifyContent: 'center',
          gap: 7,
          pointerEvents: 'none',
          opacity: phase === 'thinking' && !hfActive ? 1 : 0, // voice mode shows thinking in the bar
          transition: 'opacity .25s ease',
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'rgba(224,162,60,0.92)',
              boxShadow: '0 1px 5px rgba(0,0,0,0.18)',
              animation: 'monet-think 1.25s ease-in-out infinite',
              animationDelay: `${i * 0.16}s`,
            }}
          />
        ))}
      </div>

      {/* The bottom control — two modes:
          • text mode (mic off): a clean solid pill you type into, with a mic button to enter voice.
          • voice mode (mic on): the pill collapses to a single × button. The conversation's
            visualization now lives in the room's mood aura behind her (backdrop shader), so the UI
            stays minimal and the gaze stays on her. Tap × to leave voice mode.
          Solid (non-blurred) white with a crisp border + lift shadow → a distinct object floating
          cleanly over the room. Sized in vw + safe-area inset for mobile; 16px font (no iOS zoom).
          Overlay (desktop being): hidden entirely — clicking Monet's silhouette is the only control. */}
      {!overlay && (hfActive ? (
        <button
          onClick={() => toggleHandsFree()}
          disabled={hfStarting}
          aria-label="leave voice mode"
          title="leave voice mode"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4vh)',
            transform: 'translateX(-50%)',
            width: 52,
            height: 52,
            borderRadius: 999,
            boxSizing: 'border-box',
            background: '#ffffff',
            border: `1px solid rgba(${turnRgb},0.5)`,
            boxShadow: `0 6px 20px rgba(40,50,80,0.13), 0 1px 3px rgba(40,50,80,0.08)`,
            outline: 'none',
            appearance: 'none',
            WebkitAppearance: 'none',
            WebkitTapHighlightColor: 'transparent',
            color: 'rgba(90,84,80,0.9)',
            cursor: hfStarting ? 'progress' : 'pointer',
            opacity: hfStarting ? 0.6 : 1,
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            touchAction: 'manipulation',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            transition: 'border-color .3s ease, box-shadow .3s ease, opacity .15s ease',
          }}
        >
          <XIcon size={20} />
        </button>
      ) : (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4vh)',
            transform: 'translateX(-50%)',
            width: 'min(540px, 92vw)',
            height: 52,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 18,
            paddingRight: 7,
            borderRadius: 26,
            background: '#ffffff',
            border: `1px solid ${focused ? 'rgba(40,46,58,0.32)' : 'rgba(40,46,58,0.12)'}`,
            boxShadow: focused
              ? '0 8px 26px rgba(40,50,80,0.18), 0 1px 3px rgba(40,50,80,0.1)'
              : '0 6px 20px rgba(40,50,80,0.13), 0 1px 3px rgba(40,50,80,0.08)',
            transition: 'border-color .3s ease, box-shadow .3s ease',
          }}
        >
          <input
            ref={inputRef}
            id="monet-say"
            type="text"
            autoComplete="off"
            placeholder="say something — or tap the mic to talk"
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
              flex: 1,
              minWidth: 0,
              height: '100%',
              padding: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              font: '16px ui-rounded, system-ui, sans-serif',
              color: 'rgba(40,46,58,0.95)',
            }}
          />
          {/* Mic — tap to enter voice mode. */}
          <button
            onClick={() => toggleHandsFree()}
            disabled={hfStarting}
            aria-label="tap to talk hands-free"
            title="tap to talk hands-free"
            style={{
              flex: '0 0 auto',
              width: 40,
              height: 40,
              borderRadius: 999,
              border: 'none',
              outline: 'none',
              appearance: 'none',
              WebkitAppearance: 'none',
              WebkitTapHighlightColor: 'transparent',
              background: 'transparent',
              color: 'rgba(90,84,80,0.85)',
              cursor: hfStarting ? 'progress' : 'pointer',
              opacity: hfStarting ? 0.6 : 1,
              display: 'grid',
              placeItems: 'center',
              touchAction: 'manipulation',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              padding: 0,
            }}
          >
            <MicIcon size={20} />
          </button>
        </div>
      ))}

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
        maxHeight: 'calc(100vh - 120px)', // stop above the bottom text box (no overlap)
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
      {/* The memory list scrolls within the height-bounded panel so a long list isn't clipped
          and never reaches the text box. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7, paddingRight: 4 }}>
        {memory?.memories.map((m, i) => (
          <div key={i} style={{ opacity: 0.85, lineHeight: 1.35 }}>
            • {m}
          </div>
        ))}
      </div>
    </div>
  )
}
