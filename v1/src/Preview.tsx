import { useCallback, useRef, useState } from 'react'
import Stage from './Stage'

// ── Monet behavior FSM (hand-rolled, no deps) ───────────────────────────────
// A *state* owns a pool of clips. While in a state we play clips from its pool;
// when a clip ends, the state decides which state to go to next. Start simple:
// one `resting` state that randomly cycles the idle clips. The Stage player
// cross-dissolves between clips in the shader, so cuts don't pop.
type StateName = 'resting'

const STATES: Record<StateName, { pool: string[]; onEnd: () => StateName }> = {
  resting: {
    pool: ['monet-idle-1', 'monet-idle-2', 'monet-idle-3'],
    onEnd: () => 'resting',
  },
}

const clipSrc = (name: string) => `/contents/monet/${name}.mp4`

function pickClip(pool: string[], avoid: string | null) {
  const choices = avoid && pool.length > 1 ? pool.filter((c) => c !== avoid) : pool
  return choices[Math.floor(Math.random() * choices.length)]
}

export default function Preview() {
  const [started, setStarted] = useState(false)
  const [clip, setClip] = useState<string>(() => pickClip(STATES.resting.pool, null))
  const [plays, setPlays] = useState(0)
  const stateRef = useRef<StateName>('resting')

  // Active clip finished → ask the FSM what to play next; Stage cross-dissolves.
  const advance = useCallback(() => {
    const next = STATES[stateRef.current].onEnd()
    stateRef.current = next
    setClip((prev) => pickClip(STATES[next].pool, prev))
    setPlays((n) => n + 1)
  }, [])

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
        <Stage
          src={clipSrc(clip)}
          seq={plays}
          onClipEnd={advance}
          blendMs={300}
          style={{ width: 'min(80vw, 80vh, 480px)', aspectRatio: '1 / 1' }}
        />
      ) : (
        // Before the wake gesture (autoplay is gated): show Monet's poster, static.
        <div
          style={{ position: 'relative', width: 'min(80vw, 80vh, 480px)', aspectRatio: '1 / 1' }}
        >
          <img
            src={`/contents/monet/${clip}.thumbnail.webp`}
            alt="Monet"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              font: '15px ui-monospace, monospace',
              color: '#5a5048',
            }}
          >
            <span style={{ background: '#faf7f2cc', padding: '6px 12px', borderRadius: 999 }}>
              ▶ tap to wake Monet
            </span>
          </div>
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
clip:  ${clip}
plays: ${plays}
${started ? 'resting — random idle, shader crossfade' : 'tap to start'}`}
      </div>
    </div>
  )
}
