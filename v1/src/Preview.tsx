import { useCallback, useRef, useState } from 'react'
import StackedVideo from './StackedVideo'

// ── Monet behavior FSM (hand-rolled, no deps) ───────────────────────────────
// A *state* owns a pool of clips. While in a state we play clips from its pool;
// when a clip ends, the state decides which state to go to next. Start simple:
// one `resting` state that randomly cycles the idle clips.
type StateName = 'resting'

const STATES: Record<StateName, { pool: string[]; onEnd: () => StateName }> = {
  resting: {
    pool: ['monet-idle-1', 'monet-idle-2', 'monet-idle-3'],
    onEnd: () => 'resting', // keep resting → pick another idle
  },
}

const clipSrc = (name: string) => `/contents/monet/${name}.mp4`
const FADE_MS = 350 // crossfade between clips so cuts (color/pose) don't pop

// Pick a clip from the pool, avoiding an immediate repeat when possible.
function pickClip(pool: string[], avoid: string | null) {
  const choices = avoid && pool.length > 1 ? pool.filter((c) => c !== avoid) : pool
  return choices[Math.floor(Math.random() * choices.length)]
}

type Layer = { id: number; clip: string }

export default function Preview() {
  const [started, setStarted] = useState(false)
  const [layers, setLayers] = useState<Layer[]>(() => [
    { id: 0, clip: pickClip(STATES.resting.pool, null) },
  ])
  const [shownId, setShownId] = useState(0) // the layer that should be opaque
  const [plays, setPlays] = useState(0)
  const idRef = useRef(1)
  const stateRef = useRef<StateName>('resting')

  // A clip finished → pick the next (per the FSM) and stack it as a new layer.
  // It fades in once it's actually playing (onReady), crossfading over the old.
  const onEnded = useCallback((endedClip: string) => {
    const next = STATES[stateRef.current].onEnd()
    stateRef.current = next
    const clip = pickClip(STATES[next].pool, endedClip)
    const id = idRef.current++
    setLayers((ls) => [...ls.slice(-1), { id, clip }]) // keep only old + new
    setPlays((n) => n + 1)
  }, [])

  // New layer is playing → fade it in, then drop the layer underneath.
  const onReady = useCallback((id: number) => {
    setShownId(id)
    window.setTimeout(() => setLayers((ls) => ls.filter((l) => l.id === id)), FADE_MS)
  }, [])

  const shownClip = layers.find((l) => l.id === shownId)?.clip ?? layers[layers.length - 1].clip

  return (
    <div
      onPointerDown={() => setStarted(true)}
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        cursor: started ? 'default' : 'pointer',
        backgroundColor: '#efe9e1',
        backgroundImage: 'radial-gradient(circle at 50% 38%, #faf7f2, #e8e1d6)',
      }}
    >
      {started ? (
        <div style={{ position: 'relative', width: 'min(80vw, 80vh, 480px)', aspectRatio: '1 / 1' }}>
          {layers.map((l) => (
            <StackedVideo
              key={l.id}
              src={clipSrc(l.clip)}
              autoPlay
              onEnded={() => onEnded(l.clip)}
              onReady={() => onReady(l.id)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: l.id === shownId ? 1 : 0,
                transition: `opacity ${FADE_MS}ms ease`,
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ font: '15px ui-monospace, monospace', color: '#555' }}>
          ▶ tap / click to wake Monet
        </div>
      )}

      <div
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          font: '13px ui-monospace, monospace',
          background: '#000a',
          color: '#0f0',
          padding: '8px 10px',
          borderRadius: 8,
          whiteSpace: 'pre',
          pointerEvents: 'none',
        }}
      >
        {`state: ${stateRef.current}
clip:  ${shownClip}
plays: ${plays}
${started ? 'resting — random idle loop' : 'tap to start'}`}
      </div>
    </div>
  )
}
