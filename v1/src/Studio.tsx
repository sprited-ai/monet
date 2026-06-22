import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as RPointerEvent, ReactNode } from 'react'

// Monet Studio — a toy-play story stage (prototype).
// Narrator + Monet + toys. Monet is ANIMATED (APNG clips with alpha, drawn to the
// 2D canvas each frame so it records too). Drag Monet & toys, pick her action, type
// narrator lines, then PLAY & RECORD (canvas + optional mic) to webm — Silly style.
// This is the "interact" destination at the funnel's end: IG → watch → link → here.

const BG = '/studio-assets/bg'
const CLIP = '/studio-assets/clips' // animated APNGs (alpha)
const TOY = '/studio-assets/toys'
const MON = '/studio-assets/monet' // static pose PNGs (committed; fallback when clips absent)
const FALLBACK = `${MON}/idle.png` // shown if the heavy APNG isn't there (fresh clone / prod)

const BACKGROUNDS = [
  { key: 'greenhouse', src: `${BG}/greenhouse.png` },
  { key: 'stage', src: `${BG}/stage.png` },
]
// Monet actions (animated, looping APNG with alpha)
const ACTIONS = [
  { key: 'idle', src: `${CLIP}/idle.png` },
  { key: 'walk', src: `${CLIP}/walk.png` },
  { key: 'cast', src: `${CLIP}/cast.png` },
  { key: 'flower', src: `${CLIP}/flower.png` },
  { key: 'happy', src: `${CLIP}/happy.png` },
  { key: 'greet', src: `${CLIP}/greet.png` },
  { key: 'dance', src: `${CLIP}/dance.png` },
  { key: 'sit', src: `${CLIP}/sit.png` },
]
const TOYS = [
  { key: 'flower', src: `${TOY}/flower.png` },
  { key: 'star', src: `${TOY}/star.png` },
  { key: 'wateringcan', src: `${TOY}/wateringcan.png` },
  { key: 'heart', src: `${TOY}/heart.png` },
]

const W = 720
const H = 1280

type Sprite = {
  id: number
  kind: 'monet' | 'toy'
  src: string
  x: number // center
  y: number
  scale: number
  flip: boolean
}

// static image cache (backgrounds + toys). Monet's animated APNG is drawn from a
// live DOM <img> (so it actually animates) — see animRef.
const imgCache = new Map<string, HTMLImageElement>()
function loadImg(src: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(src)
  if (hit) return Promise.resolve(hit)
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => {
      imgCache.set(src, im)
      res(im)
    }
    im.onerror = rej
    im.src = src
  })
}

// Persist the scene so Monet "remembers" between visits — a first taste of
// continuity (the #1 item in docs/012-monetto-body.md). A real between-session
// loop is future work; this is computed at load, honestly a taste, not a life.
const SAVE_KEY = 'monet-studio-v1'
type Saved = { sprites: Sprite[]; bg: string; lastActive: number }
function loadSaved(): Saved | null {
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(SAVE_KEY) : null
    return s ? (JSON.parse(s) as Saved) : null
  } catch {
    return null
  }
}
const SAVED = loadSaved()
const DEFAULT_MONET: Sprite = { id: 1, kind: 'monet', src: ACTIONS[0].src, x: W / 2, y: H * 0.62, scale: 1.6, flip: false }
let nextId = SAVED?.sprites?.length ? Math.max(...SAVED.sprites.map((s) => s.id)) + 1 : 2

export default function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<HTMLImageElement>(null) // live, animating APNG for Monet
  const [ready, setReady] = useState(false)
  const [bg, setBg] = useState(SAVED?.bg ?? BACKGROUNDS[0].src)
  const [caption, setCaption] = useState('')
  const [greeting, setGreeting] = useState<string | null>(null) // Monet's "welcome back"
  const [sprites, setSprites] = useState<Sprite[]>(
    SAVED?.sprites?.some((s) => s.kind === 'monet') ? SAVED.sprites : [DEFAULT_MONET],
  )
  const [selId, setSelId] = useState<number>(1)
  const [recording, setRecording] = useState(false)
  const [useMic, setUseMic] = useState(true)
  const [clipUrl, setClipUrl] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const stateRef = useRef({ bg, caption, sprites, selId })
  stateRef.current = { bg, caption, sprites, selId }

  const recRef = useRef<{ mr: MediaRecorder; stream: MediaStream } | null>(null)
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null)

  const monet = sprites.find((s) => s.kind === 'monet')!

  // keep the live APNG <img> in sync with Monet's chosen action
  useEffect(() => {
    if (animRef.current && animRef.current.getAttribute('src') !== monet.src) animRef.current.src = monet.src
  }, [monet.src])

  // preload static assets (bg + toys); APNGs load via animRef on demand
  useEffect(() => {
    Promise.all([...BACKGROUNDS, ...TOYS, { src: FALLBACK }].map((a) => loadImg(a.src)))
      .then(() => setReady(true))
      .catch(() => setReady(true))
  }, [])

  // persist the scene every change → Monet "remembers" the garden + when you left
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ sprites, bg, lastActive: Date.now() }))
    } catch {
      /* ignore */
    }
  }, [sprites, bg])

  // on open: greet with continuity (time since last visit) + a small thing that
  // "happened" while away. A first taste of being remembered (docs/012).
  useEffect(() => {
    if (!SAVED) return
    const gapMin = (Date.now() - SAVED.lastActive) / 60000
    let line: string | null = gapMin < 1 ? null : gapMin < 60 ? '또 왔네 :)' : gapMin < 1440 ? `${Math.round(gapMin / 60)}시간 만이야. 기다렸어.` : `${Math.round(gapMin / 1440)}일 만이야! 그동안 정원 돌봐뒀어 🌱`
    if (gapMin > 20) {
      setSprites((ss) => [
        ...ss,
        { id: nextId++, kind: 'toy', src: `${TOY}/flower.png`, x: W / 2 + 130, y: H * 0.5, scale: 0.5, flip: false },
      ])
      line = (line ? line + ' ' : '') + '밤사이 꽃 하나 더 피웠어.'
    }
    if (line) {
      setGreeting(line)
      const t = setTimeout(() => setGreeting(null), 7000)
      return () => clearTimeout(t)
    }
  }, [])

  // monet draw size (APNG frame is 480²); falls back before it loads
  const monetDims = () => {
    const im = animRef.current
    if (im && im.naturalWidth) return { w: im.naturalWidth, h: im.naturalWidth }
    const fb = imgCache.get(FALLBACK)
    return fb ? { w: fb.naturalWidth, h: fb.naturalHeight } : { w: 480, h: 480 }
  }

  // render loop
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !ready) return
    const ctx = cv.getContext('2d')!
    let raf = 0
    const draw = () => {
      const { bg, caption, sprites, selId } = stateRef.current
      ctx.clearRect(0, 0, W, H)
      const bgi = imgCache.get(bg)
      if (bgi) {
        const s = Math.max(W / bgi.width, H / bgi.height)
        ctx.drawImage(bgi, (W - bgi.width * s) / 2, (H - bgi.height * s) / 2, bgi.width * s, bgi.height * s)
      } else {
        ctx.fillStyle = '#f3e9dd'
        ctx.fillRect(0, 0, W, H)
      }
      for (const sp of sprites) {
        let im: HTMLImageElement | null = null
        if (sp.kind === 'monet')
          im = animRef.current && animRef.current.naturalWidth ? animRef.current : imgCache.get(FALLBACK) || null
        else im = imgCache.get(sp.src) || null
        if (!im) continue
        const w = im.naturalWidth * sp.scale
        const h = im.naturalHeight * sp.scale
        ctx.save()
        ctx.translate(sp.x, sp.y)
        if (sp.flip) ctx.scale(-1, 1)
        ctx.drawImage(im, -w / 2, -h / 2, w, h)
        ctx.restore()
        if (sp.id === selId) {
          ctx.save()
          ctx.strokeStyle = 'rgba(80,140,255,0.9)'
          ctx.setLineDash([10, 8])
          ctx.lineWidth = 2
          ctx.strokeRect(sp.x - w / 2, sp.y - h / 2, w, h)
          ctx.restore()
        }
      }
      if (caption.trim()) {
        ctx.save()
        ctx.font = '600 38px "Apple SD Gothic Neo", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const tw = Math.min(W - 60, ctx.measureText(caption).width + 52)
        const by = H - 150
        ctx.fillStyle = 'rgba(30,22,18,0.55)'
        roundRect(ctx, (W - tw) / 2, by - 42, tw, 84, 18)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.fillText(caption, W / 2, by)
        ctx.restore()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [ready])

  // ---- pointer interaction ----
  const toCanvas = (e: RPointerEvent) => {
    const cv = canvasRef.current!
    const r = cv.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  const dimsOf = (sp: Sprite) => {
    if (sp.kind === 'monet') return monetDims()
    const im = imgCache.get(sp.src)
    return { w: im?.naturalWidth ?? 100, h: im?.naturalHeight ?? 100 }
  }
  const hitTest = (px: number, py: number): Sprite | null => {
    const { sprites } = stateRef.current
    for (let i = sprites.length - 1; i >= 0; i--) {
      const sp = sprites[i]
      const d = dimsOf(sp)
      const w = d.w * sp.scale
      const h = d.h * sp.scale
      if (px >= sp.x - w / 2 && px <= sp.x + w / 2 && py >= sp.y - h / 2 && py <= sp.y + h / 2) return sp
    }
    return null
  }
  const onDown = (e: RPointerEvent) => {
    const { x, y } = toCanvas(e)
    const sp = hitTest(x, y)
    if (sp) {
      setSelId(sp.id)
      dragRef.current = { id: sp.id, dx: x - sp.x, dy: y - sp.y }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } else setSelId(-1)
  }
  const onMove = (e: RPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const { x, y } = toCanvas(e)
    setSprites((ss) => ss.map((s) => (s.id === d.id ? { ...s, x: x - d.dx, y: y - d.dy } : s)))
  }
  const onUp = () => (dragRef.current = null)

  // ---- sprite ops ----
  const update = (id: number, patch: Partial<Sprite>) =>
    setSprites((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const sel = sprites.find((s) => s.id === selId) || null
  const addToy = (src: string) =>
    setSprites((ss) => {
      const id = nextId++
      setSelId(id)
      return [...ss, { id, kind: 'toy' as const, src, x: W / 2, y: H / 2, scale: 0.6, flip: false }]
    })
  const removeSel = useCallback(() => {
    setSprites((ss) => ss.filter((s) => !(s.id === selId && s.kind === 'toy')))
  }, [selId])
  const bringFront = () =>
    setSprites((ss) => {
      const s = ss.find((x) => x.id === selId)
      return s ? [...ss.filter((x) => x.id !== selId), s] : ss
    })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const s = stateRef.current.sprites.find((x) => x.id === stateRef.current.selId)
      if (!s) return
      const step = e.shiftKey ? 40 : 8
      if (e.key === 'ArrowLeft') update(s.id, { x: s.x - step })
      else if (e.key === 'ArrowRight') update(s.id, { x: s.x + step })
      else if (e.key === 'ArrowUp') update(s.id, { y: s.y - step })
      else if (e.key === 'ArrowDown') update(s.id, { y: s.y + step })
      else if (e.key === 'f' || e.key === 'F') update(s.id, { flip: !s.flip })
      else if (e.key === '[') update(s.id, { scale: Math.max(0.1, s.scale - 0.06) })
      else if (e.key === ']') update(s.id, { scale: s.scale + 0.06 })
      else if (e.key === 'Backspace' || e.key === 'Delete') removeSel()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeSel])

  // ---- record ----
  const startRec = async () => {
    const cv = canvasRef.current!
    const stream = cv.captureStream(30)
    if (useMic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
        mic.getAudioTracks().forEach((t) => stream.addTrack(t))
      } catch {
        /* silent */
      }
    }
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    )
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    mr.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
      setClipUrl(url)
      const a = document.createElement('a')
      a.href = url
      a.download = `monet-studio-${Date.now()}.webm`
      a.click()
      stream.getTracks().forEach((t) => t.stop())
    }
    recRef.current = { mr, stream }
    mr.start()
    setRecording(true)
    setElapsed(0)
  }
  const stopRec = () => {
    recRef.current?.mr.stop()
    recRef.current = null
    setRecording(false)
  }
  useEffect(() => {
    if (!recording) return
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(t)
  }, [recording])

  const snapshot = () =>
    canvasRef.current!.toBlob((b) => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `monet-studio-${Date.now()}.png`
      a.click()
    })

  const btn: CSSProperties = {
    border: '1px solid #d8cfc4',
    background: '#fff',
    borderRadius: 10,
    padding: '8px 12px',
    cursor: 'pointer',
    font: '13px system-ui',
  }
  const chip = (on: boolean): CSSProperties => ({
    ...btn,
    background: on ? '#ffe3ec' : '#fff',
    borderColor: on ? '#f3a6bd' : '#d8cfc4',
  })

  return (
    <div
      style={{
        display: 'flex',
        gap: 20,
        padding: 20,
        minHeight: '100vh',
        background: 'linear-gradient(160deg,#fdf3f6,#eef4ff)',
        font: '14px system-ui',
        color: '#4a4039',
      }}
    >
      {/* hidden, live-animating APNG for Monet (kept in DOM so it actually plays) */}
      <img
        ref={animRef}
        alt=""
        aria-hidden
        style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
      />

      <div style={{ flex: '0 0 auto', position: 'relative' }}>
        {greeting && (
          <div
            style={{
              position: 'absolute',
              top: 18,
              left: '50%',
              transform: 'translateX(-50%)',
              maxWidth: '80%',
              background: 'rgba(255,255,255,0.94)',
              color: '#5a4f45',
              padding: '10px 16px',
              borderRadius: 16,
              font: '600 15px system-ui',
              boxShadow: '0 6px 20px rgba(60,40,30,0.2)',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            🌸 {greeting}
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          style={{
            height: 'min(86vh, 900px)',
            aspectRatio: `${W} / ${H}`,
            borderRadius: 16,
            boxShadow: '0 10px 40px rgba(60,40,30,0.18)',
            background: '#fff',
            touchAction: 'none',
            cursor: 'grab',
          }}
        />
        {recording && (
          <div style={{ marginTop: 8, color: '#c0392b', fontWeight: 600 }}>
            ● REC {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </div>
        )}
      </div>

      <div style={{ flex: 1, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <h2 style={{ margin: '0 0 2px' }}>Monet Studio</h2>
          <div style={{ color: '#8a7d70', fontSize: 12 }}>
            토이로 이야기를 만들고 — 플레이하며 녹화하세요. 드래그 이동 · 선택 후 화살표/[ ]/F · Shift=빠르게
          </div>
        </div>

        <Section title="🎬 녹화 / 내보내기">
          {!recording ? (
            <button style={{ ...btn, background: '#ffd9e3', borderColor: '#f3a6bd' }} onClick={startRec}>
              ● 녹화 시작
            </button>
          ) : (
            <button style={{ ...btn, background: '#ffe0e0' }} onClick={stopRec}>
              ■ 정지 & 저장
            </button>
          )}
          <button style={btn} onClick={snapshot}>
            📸 PNG
          </button>
          <label style={{ ...chip(useMic), display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} />
            마이크(더빙)
          </label>
          {clipUrl && (
            <a style={{ ...btn, textDecoration: 'none' }} href={clipUrl} download="monet-studio.webm">
              ⤓ 마지막 클립
            </a>
          )}
        </Section>

        <Section title="🗣️ 나레이터 자막">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="자막 입력… (하단에 표시)"
            style={{ ...btn, flex: 1, minWidth: 240, cursor: 'text' }}
          />
          {caption && (
            <button style={btn} onClick={() => setCaption('')}>
              지우기
            </button>
          )}
        </Section>

        <Section title="🎞️ Monet 동작 (애니메이션)">
          {ACTIONS.map((a) => (
            <button key={a.key} style={chip(monet.src === a.src)} onClick={() => update(monet.id, { src: a.src })}>
              {a.key}
            </button>
          ))}
        </Section>

        <Section title="🧸 토이 (클릭해서 추가)">
          {TOYS.map((t) => (
            <button key={t.key} style={btn} onClick={() => addToy(t.src)} title={t.key}>
              <img src={t.src} alt={t.key} style={{ height: 34, display: 'block' }} />
            </button>
          ))}
        </Section>

        <Section title="🖼️ 배경">
          {BACKGROUNDS.map((b) => (
            <button key={b.key} style={chip(bg === b.src)} onClick={() => setBg(b.src)}>
              {b.key}
            </button>
          ))}
        </Section>

        <Section title="✋ 선택한 것">
          {sel ? (
            <>
              <span style={{ alignSelf: 'center', color: '#8a7d70' }}>
                {sel.kind} · {Math.round(sel.scale * 100)}%
              </span>
              <button style={btn} onClick={() => update(sel.id, { scale: sel.scale + 0.08 })}>
                ＋
              </button>
              <button style={btn} onClick={() => update(sel.id, { scale: Math.max(0.1, sel.scale - 0.08) })}>
                －
              </button>
              <button style={btn} onClick={() => update(sel.id, { flip: !sel.flip })}>
                ↔
              </button>
              <button style={btn} onClick={bringFront}>
                맨 앞
              </button>
              {sel.kind === 'toy' && (
                <button style={{ ...btn, color: '#c0392b' }} onClick={removeSel}>
                  삭제
                </button>
              )}
            </>
          ) : (
            <span style={{ color: '#b0a596' }}>스테이지에서 Monet이나 토이를 클릭</span>
          )}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#8a7d70', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
