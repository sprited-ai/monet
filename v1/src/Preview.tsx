import { useEffect, useRef, useState } from 'react'

// Stacked-alpha H.264 preview: plays each clip once, then auto-advances to the
// next WITHOUT a new gesture (proves one entry-gesture unlocks the whole session).
// See docs/008-video-rendering.md.
const CLIPS = [
  { name: 'run', src: '/preview/run.mp4' },
  { name: 'walk', src: '/preview/walk.mp4' },
  { name: 'jump', src: '/preview/jump.mp4' },
  { name: 'dance', src: '/preview/dance.mp4' },
]

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}`
const FS = `precision mediump float;varying vec2 uv;uniform sampler2D t;
void main(){vec3 rgb=texture2D(t,vec2(uv.x,uv.y*0.5)).rgb;
float a=texture2D(t,vec2(uv.x,0.5+uv.y*0.5)).r;gl_FragColor=vec4(rgb,a);}`

export default function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [idx, setIdx] = useState(0)
  const [started, setStarted] = useState(false)
  const [autoAdvances, setAutoAdvances] = useState(0)
  const [err, setErr] = useState('')

  // WebGL compositor + draw loop
  useEffect(() => {
    const cv = canvasRef.current!
    const v = videoRef.current!
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true })
    if (!gl) {
      setErr('no webgl')
      return
    }
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const pr = gl.createProgram()!
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(pr)
    gl.useProgram(pr)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const lp = gl.getAttribLocation(pr, 'p')
    gl.enableVertexAttribArray(lp)
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    let raf = 0
    const draw = () => {
      if (v.readyState >= 2) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  // Auto-advance: each clip plays once, then jump to the next.
  useEffect(() => {
    const v = videoRef.current!
    const onEnded = () => {
      setAutoAdvances((n) => n + 1)
      setIdx((i) => (i + 1) % CLIPS.length)
    }
    v.addEventListener('ended', onEnded)
    return () => v.removeEventListener('ended', onEnded)
  }, [])

  // Load current clip; play it (no gesture needed once the session is unlocked).
  useEffect(() => {
    const v = videoRef.current!
    v.src = CLIPS[idx].src
    if (started) v.play().then(() => setErr('')).catch((e) => setErr(`play: ${e.name}`))
  }, [idx, started])

  const start = () => {
    if (started) return
    setStarted(true)
    videoRef.current!.play().then(() => setErr('')).catch((e) => setErr(`play: ${e.name}`))
  }

  return (
    <div
      onPointerDown={start}
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        cursor: started ? 'default' : 'pointer',
        backgroundColor: '#fff',
        backgroundImage:
          'linear-gradient(45deg,#dcdcdc 25%,transparent 25%),linear-gradient(-45deg,#dcdcdc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#dcdcdc 75%),linear-gradient(-45deg,transparent 75%,#dcdcdc 75%)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0,0 12px,12px -12px,-12px 0',
      }}
    >
      <video ref={videoRef} muted playsInline preload="auto" style={{ display: 'none' }} />
      <canvas
        ref={canvasRef}
        width={640}
        height={640}
        style={{ width: 'min(80vw, 80vh, 480px)', aspectRatio: '1 / 1' }}
      />
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
        {`clip: ${CLIPS[idx].name} (${idx + 1}/${CLIPS.length})
auto-advances (no gesture): ${autoAdvances}
${err ? 'err: ' + err : started ? 'playing — advances on its own' : '▶ tap / click to start'}`}
      </div>
    </div>
  )
}
