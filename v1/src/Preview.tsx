import { useCallback, useEffect, useRef, useState } from 'react'
import Stage from './Stage'

// Apple Photos-style stage: a big player up top, and a horizontal filmstrip of
// every clip's thumbnail along the bottom. Whatever thumbnail is centered under
// the marker is the selected animation and loops in the stage. Tap or scroll to
// pick. (This is the manual browser; the autonomous FSM lives elsewhere.)

type Item = { key: string; name: string; type: 'animation' | 'still' }
type Framing = { frame: [number, number]; scale?: number; origin?: [number, number] }

const clipSrc = (key: string) => `/contents/${key}`
const thumbSrc = (key: string) => `/contents/${key.replace(/\.mp4$/, '.thumbnail.webp')}`
const pretty = (name: string) => name.replace(/^monet-/, '').replace(/-/g, ' ')

const THUMB = 64 // filmstrip thumbnail size (px)
const GAP = 8
const DEFAULT_ANCHOR: [number, number] = [0.5, 0.87]

export default function Preview() {
  const [clips, setClips] = useState<Item[]>([])
  const [framings, setFramings] = useState<Record<string, Framing>>({})
  const [framingOf, setFramingOf] = useState<Record<string, string>>({})
  const [sel, setSel] = useState(0) // index of the selected clip
  const [seq, setSeq] = useState(0) // bumps to (re)trigger the stage load
  const [awake, setAwake] = useState(false)
  const [zoom, setZoom] = useState(1) // global user zoom multiplier
  const stripRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const scrollTimer = useRef<number>(0)
  const programmatic = useRef(false)

  // Load the animation list + framing geometry once.
  useEffect(() => {
    Promise.all([
      fetch('/contents').then((r) => r.json() as Promise<{ items: Item[] }>),
      fetch('/contents/framings.json')
        .then((r) => r.json())
        .catch(() => ({ framings: {} })),
      fetch('/contents/index.json')
        .then((r) => r.json())
        .catch(() => ({ items: {} })),
    ]).then(([list, fr, idx]) => {
      const anims = list.items.filter((i) => i.type === 'animation')
      setClips(anims)
      setFramings(fr.framings ?? {})
      const fmap: Record<string, string> = {}
      for (const [name, e] of Object.entries(idx.items ?? {}) as [string, any][]) {
        if (e.framing) fmap[name] = e.framing
      }
      setFramingOf(fmap)
      const idle = anims.findIndex((c) => c.name === 'monet-idle-1')
      setSel(idle >= 0 ? idle : 0)
    })
  }, [])

  // Per-clip render scale + anchor (feet), from its framing.
  const geom = useCallback(
    (name: string): { scale: number; anchor: [number, number] } => {
      const f = framings[framingOf[name]]
      if (!f) return { scale: 1, anchor: DEFAULT_ANCHOR }
      const anchor: [number, number] = f.origin
        ? [f.origin[0] / f.frame[0], f.origin[1] / f.frame[1]]
        : DEFAULT_ANCHOR
      return { scale: f.scale ?? 1, anchor }
    },
    [framings, framingOf],
  )

  // Center a strip item (used on select / initial).
  const centerItem = useCallback((i: number, smooth = true) => {
    const strip = stripRef.current
    const el = itemRefs.current[i]
    if (!strip || !el) return
    programmatic.current = true
    strip.scrollTo({
      left: el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2,
      behavior: smooth ? 'smooth' : 'auto',
    })
    window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => (programmatic.current = false), 400)
  }, [])

  // Pick a clip → select, recenter, (re)load the stage.
  const choose = useCallback(
    (i: number) => {
      setSel(i)
      setSeq((s) => s + 1)
      centerItem(i)
    },
    [centerItem],
  )

  // Center the initial selection once clips + refs exist.
  useEffect(() => {
    if (clips.length) centerItem(sel, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length])

  // While scrolling the strip, select whatever lands under the center marker.
  const onScroll = useCallback(() => {
    if (programmatic.current) return
    window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => {
      const strip = stripRef.current
      if (!strip) return
      const mid = strip.scrollLeft + strip.clientWidth / 2
      let best = 0
      let bestD = Infinity
      itemRefs.current.forEach((el, i) => {
        if (!el) return
        const c = el.offsetLeft + el.clientWidth / 2
        const d = Math.abs(c - mid)
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      if (best !== sel) {
        setSel(best)
        setSeq((s) => s + 1)
      }
    }, 90)
  }, [sel])

  // Selected clip loops: when it ends, replay the same one (bump seq).
  const onClipEnd = useCallback(() => setSeq((s) => s + 1), [])

  const current = clips[sel]

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#efe9e1',
        backgroundImage: 'radial-gradient(circle at 50% 38%, #faf7f2, #e8e1d6)',
      }}
    >
      {/* Stage */}
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', position: 'relative' }}>
        {current &&
          (awake ? (
            <Stage
              src={clipSrc(current.key)}
              seq={seq}
              scale={geom(current.name).scale}
              anchor={geom(current.name).anchor}
              zoom={zoom}
              onClipEnd={onClipEnd}
              blendMs={300}
              style={{ width: 'min(78vw, 64vh, 460px)', aspectRatio: '1 / 1' }}
            />
          ) : (
            <button
              onClick={() => {
                setAwake(true)
                setSeq((s) => s + 1)
              }}
              style={{
                position: 'relative',
                width: 'min(78vw, 64vh, 460px)',
                aspectRatio: '1 / 1',
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <img
                src={thumbSrc(current.key)}
                alt={current.name}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
              <span
                style={{
                  position: 'absolute',
                  bottom: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  font: '14px ui-monospace, monospace',
                  color: '#5a5048',
                  background: '#faf7f2cc',
                  padding: '6px 14px',
                  borderRadius: 999,
                }}
              >
                ▶ tap to wake Monet
              </span>
            </button>
          ))}
        {current && (
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              font: '13px ui-monospace, monospace',
              color: '#6b5f54',
            }}
          >
            {pretty(current.name)}
          </div>
        )}

        {/* Zoom control */}
        {awake && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: '#faf7f2cc',
              padding: '6px 12px',
              borderRadius: 999,
              font: '12px ui-monospace, monospace',
              color: '#6b5f54',
            }}
          >
            <span>zoom</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              style={{ width: 160 }}
            />
            <span style={{ width: 34, textAlign: 'right' }}>{zoom.toFixed(2)}×</span>
            <button
              onClick={() => setZoom(1)}
              style={{
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                color: '#c0392b',
                font: 'inherit',
              }}
            >
              reset
            </button>
          </div>
        )}
      </div>

      {/* Filmstrip */}
      <div style={{ position: 'relative', paddingBottom: 20 }}>
        {/* center marker */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 6,
            bottom: 20,
            width: THUMB + 6,
            transform: 'translateX(-50%)',
            border: '2px solid #c0392b',
            borderRadius: 12,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
        <div
          ref={stripRef}
          onScroll={onScroll}
          style={{
            display: 'flex',
            gap: GAP,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            padding: `8px calc(50vw - ${THUMB / 2}px)`,
            scrollbarWidth: 'none',
          }}
        >
          {clips.map((c, i) => (
            <button
              key={c.key}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              onClick={() => choose(i)}
              title={pretty(c.name)}
              style={{
                flex: `0 0 ${THUMB}px`,
                width: THUMB,
                height: THUMB,
                padding: 0,
                border: 0,
                borderRadius: 10,
                overflow: 'hidden',
                scrollSnapAlign: 'center',
                cursor: 'pointer',
                background: '#fff6',
                opacity: i === sel ? 1 : 0.5,
                transform: i === sel ? 'scale(1)' : 'scale(0.86)',
                transition: 'opacity 160ms ease, transform 160ms ease',
              }}
            >
              <img
                src={thumbSrc(c.key)}
                alt={c.name}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
