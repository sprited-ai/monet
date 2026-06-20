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
  const [playing, setPlaying] = useState(false) // playback has actually started
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
      // Tap anywhere is a fallback to start playback if muted-autoplay was blocked
      // (e.g. iOS Low Power Mode). When autoplay works, nothing to tap.
      onPointerDown={() => {
        if (!playing) setSeq((s) => s + 1)
      }}
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
        {current && (
          <div
            style={{
              position: 'relative',
              width: 'min(78vw, 64vh, 460px)',
              aspectRatio: '1 / 1',
            }}
          >
            <Stage
              src={clipSrc(current.key)}
              seq={seq}
              scale={geom(current.name).scale}
              anchor={geom(current.name).anchor}
              zoom={zoom}
              onClipEnd={onClipEnd}
              onPlaying={() => setPlaying(true)}
              blendMs={300}
              style={{ width: '100%', height: '100%' }}
            />
            {/* Poster shows until playback actually starts (muted autoplay), then fades. */}
            <img
              src={thumbSrc(current.key)}
              alt={current.name}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: playing ? 0 : 1,
                transition: 'opacity 300ms ease',
                pointerEvents: 'none',
              }}
            />
          </div>
        )}
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
        <div
          onPointerDown={(e) => e.stopPropagation()}
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
      </div>

      {/* Filmstrip — Photos.app style: the centered item is the selected one,
          emphasized with a white ring + soft shadow; neighbors shrink + dim; the
          strip fades out at both edges. No marker chrome. */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          paddingTop: 18,
          paddingBottom: 'max(18px, env(safe-area-inset-bottom))',
          background: 'rgba(250,247,242,0.6)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid #0001',
        }}
      >
        <div
          ref={stripRef}
          onScroll={onScroll}
          style={{
            display: 'flex',
            gap: GAP,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            padding: `10px calc(50% - ${THUMB / 2}px)`,
            scrollbarWidth: 'none',
            WebkitMaskImage:
              'linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent)',
            maskImage: 'linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent)',
          }}
        >
          {clips.map((c, i) => {
            const on = i === sel
            return (
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
                  borderRadius: 14,
                  overflow: 'visible',
                  scrollSnapAlign: 'center',
                  cursor: 'pointer',
                  background: 'transparent',
                  opacity: on ? 1 : 0.46,
                  transform: on ? 'scale(1.12)' : 'scale(0.82)',
                  transition: 'opacity 200ms ease, transform 200ms cubic-bezier(.2,.7,.2,1)',
                }}
              >
                <img
                  src={thumbSrc(c.key)}
                  alt={c.name}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    borderRadius: 14,
                    background: '#fff7',
                    boxShadow: on
                      ? '0 0 0 3px #fff, 0 6px 16px rgba(40,30,20,0.22)'
                      : '0 0 0 1px #0001',
                    transition: 'box-shadow 200ms ease',
                  }}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
