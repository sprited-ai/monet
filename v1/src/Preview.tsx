import { useCallback, useState } from 'react'
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

// Pick a clip from the pool, avoiding an immediate repeat when possible.
function pickClip(pool: string[], avoid: string | null) {
  const choices = avoid && pool.length > 1 ? pool.filter((c) => c !== avoid) : pool
  return choices[Math.floor(Math.random() * choices.length)]
}

export default function Preview() {
  const [started, setStarted] = useState(false)
  const [state, setState] = useState<StateName>('resting')
  const [clip, setClip] = useState<string>(() => pickClip(STATES.resting.pool, null))
  const [plays, setPlays] = useState(0)

  // Clip finished → ask the current state where to go, then pick the next clip.
  const onEnded = useCallback(() => {
    const next = STATES[state].onEnd()
    setState(next)
    setClip((prev) => pickClip(STATES[next].pool, prev))
    setPlays((n) => n + 1)
  }, [state])

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
        <StackedVideo
          src={clipSrc(clip)}
          autoPlay
          onEnded={onEnded}
          style={{ width: 'min(80vw, 80vh, 480px)', aspectRatio: '1 / 1' }}
        />
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
        {`state: ${state}
clip:  ${clip}
plays: ${plays}
${started ? 'resting — random idle loop' : 'tap to start'}`}
      </div>
    </div>
  )
}
