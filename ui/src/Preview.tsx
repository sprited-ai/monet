import { useCallback, useEffect, useRef, useState } from 'react'
import Stage from './Stage'
import WebCodecsStage from './WebCodecsStage'
import type { PoseDoc, SamDoc, FaceDoc, MouthMode } from './Stage'
import type { Mouth } from './scene/types'

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

// Pill toggle style (top-right controls): filled blue when on, faint when off.
const pill = (on: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: 0,
  cursor: 'pointer',
  borderRadius: 999,
  padding: '6px 12px',
  font: '12px ui-monospace, monospace',
  background: on ? '#1d9bf0' : '#ffffffcc',
  color: on ? '#fff' : '#6b5f54',
  boxShadow: '0 1px 4px rgba(40,30,20,0.18)',
}) as const
const DEFAULT_ANCHOR: [number, number] = [0.5, 0.87]

// Deterministic test mode (for screenshot tests). `?test=1` freezes the stage on a
// single seeked frame; `clip` picks which animation, `t` the seek time, `zoom` the
// initial zoom. Off in normal use.
const TEST = (() => {
  const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  if (p.get('test') !== '1') return null
  return {
    clip: p.get('clip'),
    freezeAt: parseFloat(p.get('t') ?? '0.4'),
    zoom: p.get('zoom') ? parseFloat(p.get('zoom')!) : 1,
  }
})()

export default function Preview() {
  const [clips, setClips] = useState<Item[]>([])
  const [framings, setFramings] = useState<Record<string, Framing>>({})
  const [framingOf, setFramingOf] = useState<Record<string, string>>({})
  const [sel, setSel] = useState(0) // index of the selected clip
  const [seq, setSeq] = useState(0) // bumps to (re)trigger the stage load
  const [playing, setPlaying] = useState(false) // playback has actually started
  const [zoom, setZoom] = useState(TEST?.zoom ?? 1) // global user zoom multiplier
  const [overlay, setOverlay] = useState<'off' | 'sam' | 'bizarre'>('sam') // x-ray: A=SAM, B=bizarre (on by default; face rig is its own toggle)
  const [faceRig, setFaceRig] = useState(false) // anime-face-detector 28-kp rig — its own overlay, OFF by default
  const [shadow, setShadow] = useState(true) // contact shadow under her feet, on by default
  const [pose, setPose] = useState<PoseDoc | null>(null) // current clip's pose data (bizarre)
  const [s3body, setS3body] = useState<SamDoc | null>(null) // current clip's SAM-3D-Body rig
  const [face, setFace] = useState<FaceDoc | null>(null) // current clip's anime-face-detector rig
  const [mouth, setMouth] = useState<Mouth | null>(null) // current clip's SAM3 mouth track
  const [mouthMode, setMouthMode] = useState<MouthMode>('contour') // contour → erase → off
  const [engine, setEngine] = useState<'video' | 'webcodecs'>('video') // player backend (A/B test)
  const [scrub, setScrub] = useState<number | null>(null) // null = autoplay; a frame index pins it
  const [total, setTotal] = useState(0) // total frames (for the scrubber range), set on clip change
  const sliderRef = useRef<HTMLInputElement>(null) // scrubber input, driven by ref to avoid per-frame re-render
  const frameLabelRef = useRef<HTMLSpanElement>(null)
  const frameRef = useRef(0) // latest displayed frame, so the pause button can pin to it
  const stageWrapRef = useRef<HTMLDivElement>(null) // wheel/pinch zoom target
  const [barH, setBarH] = useState(132) // filmstrip bar height (stage sits above it)
  const stripRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const scrollTimer = useRef<number>(0)
  const programmatic = useRef(false)

  // Keep the stage area sized above the filmstrip so Monet never leaks under it.
  useEffect(() => {
    const measure = () => barRef.current && setBarH(barRef.current.offsetHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [clips.length])

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
      // Deep-link: ?clip=<name> (e.g. ?clip=monet-talk-2) wins, else the test/default clip.
      const urlClip = new URLSearchParams(window.location.search).get('clip')
      const want = urlClip ?? TEST?.clip ?? 'monet-idle-1'
      const start = anims.findIndex((c) => c.name === want || c.key.includes(want))
      setSel(start >= 0 ? start : 0)
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

  // Left/Right arrows step clips globally — no need to focus the filmstrip first.
  // Skipped when typing in a field or when a control (e.g. the zoom slider) is
  // focused, so arrows there keep their native behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (!clips.length) return
      const next = Math.min(clips.length - 1, Math.max(0, sel + (e.key === 'ArrowRight' ? 1 : -1)))
      if (next !== sel) {
        e.preventDefault()
        choose(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, clips.length, choose])

  const current = clips[sel]

  // Keep the URL in sync with the selection so it's shareable / reloadable.
  useEffect(() => {
    if (!current) return
    const u = new URL(window.location.href)
    u.searchParams.set('clip', current.name)
    window.history.replaceState(null, '', u)
  }, [current?.name])

  // Fetch the selected clip's pose JSON for the overlay. Missing (not yet generated)
  // → null, and the overlay simply draws nothing for that clip.
  useEffect(() => {
    if (!current) {
      setPose(null)
      return
    }
    let cancelled = false
    setPose(null)
    setS3body(null)
    setFace(null)
    setMouth(null)
    setScrub(null) // new clip → back to autoplay
    fetch(`/contents/${current.key.replace(/\.mp4$/, '.pose.json')}`)
      .then((r) => (r.ok ? (r.json() as Promise<PoseDoc>) : null))
      .then((d) => !cancelled && setPose(d))
      .catch(() => !cancelled && setPose(null))
    fetch(`/contents/${current.key.replace(/\.mp4$/, '.s3body.json')}`)
      .then((r) => (r.ok ? (r.json() as Promise<SamDoc>) : null))
      .then((d) => !cancelled && setS3body(d))
      .catch(() => !cancelled && setS3body(null))
    fetch(`/contents/${current.key.replace(/\.mp4$/, '.face.json')}`)
      .then((r) => (r.ok ? (r.json() as Promise<FaceDoc>) : null))
      .then((d) => !cancelled && setFace(d))
      .catch(() => !cancelled && setFace(null))
    fetch(`/contents/${current.key.replace(/\.mp4$/, '.mouth.json')}`)
      .then((r) => (r.ok ? (r.json() as Promise<Mouth>) : null))
      .then((d) => !cancelled && setMouth(d))
      .catch(() => !cancelled && setMouth(null))
    return () => {
      cancelled = true
    }
  }, [current?.key])

  // Frame readout from the Stage (each draw). Drive the scrubber + label by ref so the
  // ~60fps stream doesn't re-render Preview; only `total` (rare) goes through state.
  const onFrame = useCallback(
    (f: number, t: number) => {
      frameRef.current = f
      if (t !== total) setTotal(t)
      if (scrub === null) {
        if (sliderRef.current) sliderRef.current.value = String(f)
        if (frameLabelRef.current) frameLabelRef.current.textContent = `${f} / ${Math.max(0, t - 1)}`
      }
    },
    [scrub, total],
  )
  const clipFps = mouth?.fps ?? pose?.fps ?? 24

  // Wheel / trackpad-pinch dollies the camera on Monet (the zoom slider is gone —
  // pinch is enough). ctrl+wheel = pinch (tiny deltas → bigger gain). Native listener
  // (passive:false) so we can preventDefault the browser's page-zoom on pinch.
  useEffect(() => {
    const el = stageWrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const k = e.ctrlKey ? 0.02 : 0.0016
      setZoom((z) => Math.min(4, Math.max(0.5, z * Math.exp(-e.deltaY * k))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      // Tap anywhere is a fallback to start playback if muted-autoplay was blocked
      // (e.g. iOS Low Power Mode). When autoplay works, nothing to tap.
      onPointerDown={() => {
        if (!playing) setSeq((s) => s + 1)
      }}
      style={{
        position: 'relative',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#fdf3f6',
        backgroundImage:
          'linear-gradient(160deg, #ffe3ec 0%, #fff2cc 22%, #d9f7d0 45%, #d4f1ff 68%, #ece0ff 100%)',
      }}
    >
      {/* Stage — fills the screen above the filmstrip; canvas object-fit:contain
          keeps Monet undistorted and fully visible (never under the strip). */}
      {current && (
        <div ref={stageWrapRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: barH }}>
          {engine === 'webcodecs' ? (
            <WebCodecsStage
              src={clipSrc(current.key)}
              scale={geom(current.name).scale}
              anchor={geom(current.name).anchor}
              baseline={[0.5, 0.87]}
              zoom={zoom}
              feather={0.04}
              mouth={mouth}
              mouthMode={mouthMode}
              fps={clipFps}
              scrub={scrub}
              onFrame={onFrame}
              onReady={() => setPlaying(true)}
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
          ) : (
            <Stage
              src={clipSrc(current.key)}
              seq={seq}
              scale={geom(current.name).scale}
              anchor={geom(current.name).anchor}
              zoom={zoom}
              pose={pose}
              s3body={s3body}
              face={face}
              mouth={mouth}
              mouthMode={mouthMode}
              fps={clipFps}
              scrub={scrub}
              onFrame={onFrame}
              showOverlay={overlay !== 'off'}
              overlaySource={overlay === 'sam' ? 'sam' : 'bizarre'}
              showFace={faceRig}
              showShadow={shadow}
              onClipEnd={onClipEnd}
              onPlaying={() => setPlaying(true)}
              blendMs={300}
              freezeAt={TEST?.freezeAt}
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
          )}
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

        {/* Top-right toggles: contact shadow + x-ray pose overlay (both on by default). */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: 12, right: 14, display: 'flex', gap: 8 }}
        >
          {zoom !== 1 && (
            <button onClick={() => setZoom(1)} title="reset zoom" style={pill(false)}>
              ⊙ {zoom.toFixed(1)}× · reset
            </button>
          )}
          <button onClick={() => setShadow((v) => !v)} title="toggle contact shadow" style={pill(shadow)}>
            {shadow ? '◉' : '○'} shadow
          </button>
          <button
            onClick={() => setFaceRig((v) => !v)}
            title="toggle the face rig (anime-face-detector 28-kp landmarks)"
            style={pill(faceRig)}
          >
            {faceRig ? '◉' : '○'} face
            {faceRig && !face && current && <span style={{ opacity: 0.8 }}>· no data</span>}
          </button>
          <button
            onClick={() => setOverlay((v) => (v === 'sam' ? 'bizarre' : v === 'bizarre' ? 'off' : 'sam'))}
            title="x-ray: A (SAM rig) → B (bizarre) → off"
            style={pill(overlay !== 'off')}
          >
            {overlay === 'off' ? '○ x-ray' : overlay === 'sam' ? '◉ x-ray A · SAM' : '◉ x-ray B · bizarre'}
            {overlay === 'sam' && !s3body && current && <span style={{ opacity: 0.8 }}>· no data</span>}
            {overlay === 'bizarre' && !pose && current && <span style={{ opacity: 0.8 }}>· no data</span>}
          </button>
          <button
            onClick={() => setMouthMode((m) => (m === 'contour' ? 'erase' : m === 'erase' ? 'off' : 'contour'))}
            title="mouth: contour overlay → erase (flat-fill) → off"
            style={pill(mouthMode !== 'off')}
          >
            {mouthMode === 'contour' ? '◈' : mouthMode === 'erase' ? '◉' : '○'} mouth
            {mouthMode === 'contour' ? ' · contour' : mouthMode === 'erase' ? ' · erase' : ''}
            {mouthMode !== 'off' && !mouth && current && <span style={{ opacity: 0.8 }}>· no data</span>}
          </button>
          <button
            onClick={() => setEngine((e) => (e === 'video' ? 'webcodecs' : 'video'))}
            title="player backend: <video>+rVFC vs WebCodecs (frame-exact erase). WebCodecs = single clip, no blend/x-ray."
            style={pill(engine === 'webcodecs')}
          >
            {engine === 'webcodecs' ? '◉ WebCodecs' : '○ video'}
          </button>
        </div>

        {/* Frame scrubber — autoplay by default; grabbing the slider pins/pauses the frame. */}
        {current && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: barH + 52,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: '#ffffffcc',
              padding: '6px 12px',
              borderRadius: 999,
              font: '12px ui-monospace, monospace',
              color: '#6b5f54',
            }}
          >
            <button
              onClick={() => {
                if (scrub === null) {
                  const f = frameRef.current
                  if (sliderRef.current) sliderRef.current.value = String(f)
                  if (frameLabelRef.current) frameLabelRef.current.textContent = `${f} / ${Math.max(0, total - 1)}`
                  setScrub(f)
                } else setScrub(null)
              }}
              title={scrub === null ? 'pause' : 'play'}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: '15px ui-monospace', color: '#6b5f54' }}
            >
              {scrub === null ? '⏸' : '▶'}
            </button>
            <input
              ref={sliderRef}
              type="range"
              min={0}
              max={Math.max(1, total - 1)}
              defaultValue={0}
              step={1}
              onPointerDown={(e) => {
                const v = Number((e.target as HTMLInputElement).value)
                if (frameLabelRef.current) frameLabelRef.current.textContent = `${v} / ${Math.max(0, total - 1)}`
                setScrub(v)
              }}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (frameLabelRef.current) frameLabelRef.current.textContent = `${v} / ${Math.max(0, total - 1)}`
                setScrub(v)
              }}
              style={{ width: 280 }}
            />
            <span ref={frameLabelRef} style={{ minWidth: 70, textAlign: 'right' }}>
              0 / {Math.max(0, total - 1)}
            </span>
          </div>
        )}

      {/* Filmstrip — Photos.app style: the centered item is the selected one,
          emphasized with a white ring + soft shadow; neighbors shrink + dim; the
          strip fades out at both edges. No marker chrome. */}
      <div
        ref={barRef}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: 18,
          paddingBottom: 'max(18px, env(safe-area-inset-bottom))',
          background: 'rgba(255,255,255,0.5)',
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
