import { useEffect, useRef, useState } from 'react'
import { mat4, vec3 } from 'gl-matrix'
import { CharacterNode } from './scene/nodes/CharacterNode'
import type { Face, Frame, Framing, Mouth, Toggles } from './scene/types'
import { webCodecsSupported } from './webcodecs/ClipDecoder'
import { resumeAudio, speak, mouthOpen } from './voice'
import { textToSchedule, scheduleFromAlignment, scheduleDuration, sampleShape, sampleViseme, jawViseme, type VisemeEvent } from './viseme'

type Mode = 'slider' | 'sine' | 'audio' | 'viseme' | 'jaw'

// /mouth — isolated lab for tuning Monet's lip-sync mouth. It drives the REAL CharacterNode
// (same sprite.frag/vert that ships in the whiteroom) with a flat front camera, so the mouth
// tuned here is exactly what renders live. Pick any animation from the select box; it loops so
// you can watch the lip-sync ride over a moving clip. See docs/superpowers/specs/.

const CLIP0 = 'monet-talk-2'
const FALLBACK_FRAMING: Framing = { frame: [640, 640] }
const NO_TOGGLES: Toggles = { shadow: false, vignette: false, grain: false }

const fetchMouth = (name: string): Promise<Mouth | null> =>
  fetch(`/contents/monet/${name}.mouth.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const fetchFace = (name: string): Promise<Face | null> =>
  fetch(`/contents/monet/${name}.face.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)

export default function MouthLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const openRef = useRef(0)
  const [open, setOpen] = useState(0)
  const modeRef = useRef<Mode>('jaw')
  const [mode, setMode] = useState<Mode>('jaw')
  const schedRef = useRef<VisemeEvent[]>([])
  const playStartRef = useRef(0)
  const [text, setText] = useState('안녕, 나는 모네또야. 만나서 반가워!')
  const charRef = useRef<CharacterNode | null>(null)
  const [scale, setScale] = useState(89) // sprite cell width, BASE (1024²) px
  const [spriteY, setSpriteY] = useState(-3.5) // vertical nudge, BASE px (+ down)
  const [eraseDilate, setEraseDilate] = useState(5.5) // erase dilation, BASE px
  const [eraseFeather, setEraseFeather] = useState(3.5) // erase feather, BASE px
  const [anchor, setAnchor] = useState<'center' | 'top' | 'corners'>('corners')
  // animation select + loop
  const [clips, setClips] = useState<string[]>([CLIP0])
  const [clip, setClip] = useState(CLIP0)
  const clipRef = useRef(CLIP0)
  const [loopViseme, setLoopViseme] = useState(true)
  const loopRef = useRef(true)
  const [rigOn, setRigOn] = useState(true) // preview rig on (sprite) vs off (native baked mouth)
  const framingsRef = useRef<Record<string, Framing>>({})
  const indexRef = useRef<Record<string, { framing?: string; key?: string }>>({})

  const framingFor = (name: string): Framing =>
    framingsRef.current[indexRef.current[name]?.framing ?? 'regular'] ?? FALLBACK_FRAMING

  // Load + (on end) loop a clip; the viseme schedule plays on its own clock over it.
  const loadClip = (name: string) => {
    const c = charRef.current
    if (!c) return
    clipRef.current = name
    // rigMode 'talk' so the rig is gated by char.rigActive (the rig on/off toggle below).
    c.setClip(`/contents/monet/${name}.mp4`, framingFor(name), null, fetchMouth(name), fetchFace(name), { rigMode: 'talk' })
  }

  const applyMode = (m: Mode) => {
    setMode(m)
    modeRef.current = m
    const c = charRef.current
    if (!c) return
    if (m === 'viseme') c.mouthVisemeSource = () => sampleViseme(schedRef.current, performance.now() - playStartRef.current)
    // jaw = anime jaw-open: openness from audio amplitude > playing text schedule > the slider.
    else if (m === 'jaw') c.mouthVisemeSource = () => {
      const a = mouthOpen()
      if (a > 0.01) return jawViseme(a)
      if (schedRef.current.length) return jawViseme(sampleShape(schedRef.current, performance.now() - playStartRef.current).open)
      return jawViseme(openRef.current)
    }
    else c.mouthVisemeSource = null
  }

  useEffect(() => {
    if (!webCodecsSupported()) return
    const cv = canvasRef.current!
    const gl = cv.getContext('webgl2', { premultipliedAlpha: false, alpha: false })
    if (!gl) return

    const char = new CharacterNode(gl, cv.parentElement!)
    charRef.current = char
    char.mouthSpriteScale = scale // lab uses its own slider value, not the whiteroom default
    char.mouthSpriteY = spriteY
    char.rigActive = rigOn // rig on/off preview
    char.mouthEraseDilate = eraseDilate
    char.mouthEraseFeather = eraseFeather
    char.onClipEnd = () => loadClip(clipRef.current) // loop the current animation

    // Per-clip framing + the clip list (only animations with a sidecar mouth track).
    Promise.all([
      fetch('/contents/framings.json').then((r) => r.json()).catch(() => ({ framings: {} })),
      fetch('/contents/index.json').then((r) => r.json()).catch(() => ({ items: {} })),
    ]).then(([fr, idx]) => {
      framingsRef.current = fr.framings ?? {}
      indexRef.current = idx.items ?? {}
      const names = Object.keys(indexRef.current).filter((n) => indexRef.current[n].key?.endsWith('.mp4')).sort()
      if (names.length) setClips(names)
      loadClip(clipRef.current) // reload now that framing is known
    })
    loadClip(CLIP0) // first paint before the index lands

    const curShape = () => sampleShape(schedRef.current, performance.now() - playStartRef.current)
    char.mouthOpenSource = () => {
      if (modeRef.current === 'viseme') return curShape().open
      if (modeRef.current === 'audio') return mouthOpen()
      if (modeRef.current === 'sine') return 0.5 + 0.5 * Math.sin(performance.now() / 120)
      return openRef.current
    }
    char.mouthWideSource = () => (modeRef.current === 'viseme' ? curShape().width : 1)
    char.mouthVisemeSource = () => {
      if (modeRef.current === 'viseme') return sampleViseme(schedRef.current, performance.now() - playStartRef.current)
      const a = mouthOpen()
      if (a > 0.01) return jawViseme(a)
      if (schedRef.current.length) return jawViseme(sampleShape(schedRef.current, performance.now() - playStartRef.current).open)
      return jawViseme(openRef.current)
    }

    const view = mat4.create()
    const proj = mat4.create()
    const right = vec3.fromValues(1, 0, 0)
    const ambient = vec3.fromValues(1, 1, 1)

    let raf = 0
    let last = 0
    const loop = (now: number) => {
      const dt = last ? now - last : 16
      last = now
      // Loop the lip-sync schedule so it keeps riding over the looping animation.
      if (loopRef.current && schedRef.current.length && now - playStartRef.current > scheduleDuration(schedRef.current) + 600) {
        playStartRef.current = now
      }
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
      gl.viewport(0, 0, cv.width, cv.height)
      gl.clearColor(0.93, 0.92, 0.9, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      // Match the whiteroom camera (Renderer.cam) EXACTLY so the mouth size previewed here is
      // the size that ships — fov 34°, eye [0,1.45,3.9], target [0,1.3,0].
      mat4.lookAt(view, [0, 1.45, 3.9], [0, 1.3, 0], [0, 1, 0])
      mat4.perspective(proj, (34 * Math.PI) / 180, cv.width / cv.height, 0.1, 100)
      const frame: Frame = {
        gl, now, dt, view, proj, right, zoom: 1, ambient,
        width: cv.width, height: cv.height, toggles: NO_TOGGLES,
      }
      char.update(frame)
      char.draw(frame)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      char.dispose()
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#eeece8' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div style={{ position: 'fixed', top: 16, left: 16, zIndex: 1, color: '#333', font: '13px system-ui', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          animation:{' '}
          <select value={clip} onChange={(e) => { setClip(e.target.value); loadClip(e.target.value) }} style={{ font: '13px system-ui', maxWidth: 260 }}>
            {clips.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          {(['slider', 'sine', 'audio', 'viseme', 'jaw'] as const).map((m) => (
            <button key={m} onClick={() => applyMode(m)} style={{ marginRight: 6, fontWeight: mode === m ? 700 : 400 }}>{m}</button>
          ))}
          <label style={{ marginLeft: 6 }}>
            <input type="checkbox" checked={loopViseme} onChange={(e) => { setLoopViseme(e.target.checked); loopRef.current = e.target.checked }} /> loop
          </label>
          <label style={{ marginLeft: 6 }}>
            <input type="checkbox" checked={rigOn} onChange={(e) => { setRigOn(e.target.checked); if (charRef.current) charRef.current.rigActive = e.target.checked }} /> rig
          </label>
        </div>
        <div>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 240, font: '13px system-ui' }} />
        </div>
        <div>
          <button onClick={() => { schedRef.current = textToSchedule(text); playStartRef.current = performance.now(); applyMode('jaw') }}>
            ▶ play visemes (no audio)
          </button>
          <button style={{ marginLeft: 6 }} onClick={() => {
            resumeAudio()
            speak(text, (alignment) => {
              const aligned = scheduleFromAlignment(alignment)
              schedRef.current = aligned.length ? aligned : textToSchedule(text)
              playStartRef.current = performance.now()
              applyMode('jaw')
            })
          }}>
            🔊 speak + visemes
          </button>
        </div>
        <div>
          sprite size {scale.toFixed(0)} px
          <input type="range" min={40} max={160} step={1} value={scale}
            onChange={(e) => { const v = +e.target.value; setScale(v); if (charRef.current) charRef.current.mouthSpriteScale = v }}
            style={{ width: 200, marginLeft: 6, verticalAlign: 'middle' }} />
          <br />
          sprite Y {spriteY.toFixed(1)} px (+ down)
          <input type="range" min={-30} max={30} step={0.5} value={spriteY}
            onChange={(e) => { const v = +e.target.value; setSpriteY(v); if (charRef.current) charRef.current.mouthSpriteY = v }}
            style={{ width: 200, marginLeft: 6, verticalAlign: 'middle' }} />
          <br />
          erase dilate {eraseDilate.toFixed(1)} px
          <input type="range" min={0} max={40} step={0.5} value={eraseDilate}
            onChange={(e) => { const v = +e.target.value; setEraseDilate(v); if (charRef.current) charRef.current.mouthEraseDilate = v }}
            style={{ width: 200, marginLeft: 6, verticalAlign: 'middle' }} />
          <br />
          erase feather {eraseFeather.toFixed(1)} px
          <input type="range" min={0} max={20} step={0.5} value={eraseFeather}
            onChange={(e) => { const v = +e.target.value; setEraseFeather(v); if (charRef.current) charRef.current.mouthEraseFeather = v }}
            style={{ width: 200, marginLeft: 6, verticalAlign: 'middle' }} />
        </div>
        <div>
          anchor:{' '}
          {(['center', 'top', 'corners'] as const).map((a) => (
            <button key={a} onClick={() => { setAnchor(a); if (charRef.current) charRef.current.mouthAnchorMode = a }}
              style={{ marginRight: 6, fontWeight: anchor === a ? 700 : 400 }}>{a}</button>
          ))}
        </div>
        {/* manual openness (slider mode) */}
        <div>
          open {open.toFixed(2)}
          <input type="range" min={0} max={1} step={0.01} value={open}
            onChange={(e) => { const v = +e.target.value; setOpen(v); openRef.current = v }}
            style={{ width: 200, marginLeft: 6, verticalAlign: 'middle' }} />
        </div>
      </div>
    </div>
  )
}
