import { useEffect, useRef, useState } from 'react'
import { StreamingClip, webCodecsSupported } from './webcodecs/ClipDecoder'

// /webcodex — WebCodecs decoder-budget benchmark. Decodes N 640×640 clips concurrently,
// drives them all from ONE shared frame clock (lockstep), uploads each frame to its own
// texture, and a single shader paints them into a √N×√N grid. The point is empirical: how
// many frame-synced VideoDecoders can THIS device sustain before decode falls behind the
// play clock? See docs/018 + [[monet-webcodecs-mouth-compositing]]. iOS/Safari is the
// binding case (VideoToolbox session pool is small + undocumented) — measure it, don't guess.

// 640×640 raw seedance originals (RGB on #808080). Served off disk in dev (vite devContents
// streams any file under contents/, source/ included) and from R2 in prod.
const POOL = [
  'monet-angry-1', 'monet-angry-2', 'monet-angry-large-1', 'monet-angry-large-2',
  'monet-back-to-front-1', 'monet-back-walk-wide-1', 'monet-bazooka-1', 'monet-cast-magic-1',
  'monet-cast-magic-2', 'monet-cast-magic-3', 'monet-cast-magic-large-1', 'monet-chill-large-1',
  'monet-cough-large-1', 'monet-cough-large-2', 'monet-cry-large-1', 'monet-cry-large-2',
  'monet-dance-large-1', 'monet-doze-off', 'monet-drink-water-1', 'monet-drink-water-large-1',
  'monet-dust', 'monet-eat-bread', 'monet-flower-magic-1', 'monet-gets-angry-and-turns-back',
  'monet-greet-1', 'monet-happy-1', 'monet-happy-2', 'monet-idle-1',
  'monet-idle-2', 'monet-idle-3', 'monet-jump-large-1', 'monet-jump-large-2',
  'monet-jump-large-3', 'monet-jumping-jacks-large-1', 'monet-jumping-jacks-large-2', 'monet-light-dance-1',
  'monet-lookup-2', 'monet-paint-large-1', 'monet-prepare-to-throw-wide-1', 'monet-run-1',
  'monet-run-2', 'monet-run-3', 'monet-run-4', 'monet-scared-large-1',
  'monet-sit-1', 'monet-sit-2', 'monet-stands-up-1', 'monet-stunt-wide-1',
  'monet-stunt-wide-2', 'monet-talk-2', 'monet-talk-happy-large-1', 'monet-talk-large-1',
  'monet-talk-sad-stuff-large-1', 'monet-throw-ball-wide', 'monet-throw-wide-1', 'monet-turn-twice-1',
  'monet-turns-back-to-front-1', 'monet-turns', 'monet-umbrella-in-large-1', 'monet-umbrella-large-1',
  'monet-umbrella-out-large-1', 'monet-wakes-up-1', 'monet-walk', 'monet-weird-backwards-dance-wide-1',
]
const url = (name: string) => `/contents/monet/source/originals/${name}.mp4`
const FPS = 24

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2((p.x+1.0)/2.0, (p.y+1.0)/2.0); gl_Position = vec4(p, 0.0, 1.0); }`
const FS = `#version 300 es
precision mediump float;
in vec2 uv; out vec4 o;
uniform sampler2D t;
void main(){ o = vec4(texture(t, vec2(uv.x, 1.0 - uv.y)).rgb, 1.0); }` // VideoFrame is top-left origin → flip v

type Stat = { lag: number; idx: number; total: number; ready: boolean }

export default function Webcodex() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [count, setCount] = useState(4)
  const [accel, setAccel] = useState<'prefer-hardware' | 'prefer-software'>('prefer-hardware')
  const [supported] = useState(webCodecsSupported)
  const [hud, setHud] = useState<{ fps: number; worstLag: number; ready: number; stats: Stat[] }>({
    fps: 0, worstLag: 0, ready: 0, stats: [],
  })

  useEffect(() => {
    if (!supported) return
    const cv = canvasRef.current!
    const gl = cv.getContext('webgl2', { premultipliedAlpha: false, alpha: false })
    if (!gl) return

    // program
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
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
    gl.uniform1i(gl.getUniformLocation(pr, 't'), 0)

    const mkTex = () => {
      const tx = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tx)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 20]))
      return tx
    }

    const n = count
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const textures = Array.from({ length: n }, mkTex)
    const clips: (StreamingClip | null)[] = new Array(n).fill(null)
    let cancelled = false
    let raf = 0

    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round((cv.clientWidth || 1) * dpr))
      const h = Math.max(1, Math.round((cv.clientHeight || 1) * dpr))
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
    }
    sizeCanvas()
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(cv)

    // spin up N decoders (distinct clips from the pool)
    for (let i = 0; i < n; i++) {
      const name = POOL[i % POOL.length]
      StreamingClip.create(url(name), FPS, accel)
        .then((c) => { if (cancelled) c.close(); else clips[i] = c })
        .catch((e) => console.error('webcodex: clip', i, name, e?.message || e))
    }

    let startMs = -1
    let frames = 0
    let fpsT = performance.now()
    let lastFps = 0

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (startMs < 0) startMs = now
      const wantIdx = Math.floor(((now - startMs) / 1000) * FPS)

      gl.clearColor(0.08, 0.08, 0.08, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      const cw = Math.floor(cv.width / cols)
      const ch = Math.floor(cv.height / rows)
      const stats: Stat[] = []
      for (let i = 0; i < n; i++) {
        const clip = clips[i]
        const col = i % cols
        const row = Math.floor(i / cols)
        // GL viewport origin is bottom-left; our grid reads top-to-bottom → invert row.
        const vx = col * cw
        const vy = cv.height - (row + 1) * ch
        let lag = -1, idx = 0, total = 0
        if (clip && clip.total > 0) {
          total = clip.total
          idx = ((wantIdx % total) + total) % total
          const got = clip.frameAt(idx)
          if (got) {
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, textures[i])
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, got.frame)
            // lag = how far the on-hand frame trails the clock's request (decoder behind)
            lag = (idx - got.index + total) % total
          }
          // No new frame mid loop-wrap restart? Don't blank the cell — the texture still holds
          // the last decoded frame, so we redraw THAT (a brief freeze) instead of a black flash.
        }
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, textures[i])
        gl.viewport(vx, vy, cw, ch)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        stats.push({ lag, idx, total, ready: clip?.ready ?? false })
      }

      frames++
      if (now - fpsT >= 500) {
        lastFps = (frames * 1000) / (now - fpsT)
        frames = 0
        fpsT = now
        const ready = stats.filter((s) => s.ready).length
        const worstLag = stats.reduce((m, s) => Math.max(m, s.lag), 0)
        setHud({ fps: Math.round(lastFps * 10) / 10, worstLag, ready, stats })
      }
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      for (const c of clips) c?.close()
      for (const t of textures) gl.deleteTexture(t)
    }
  }, [count, accel, supported])

  if (!supported) {
    return <div style={panel}>WebCodecs not supported in this browser.</div>
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#ddd', font: '13px ui-monospace, monospace' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div style={hudBox}>
        <div style={{ fontSize: 15, marginBottom: 6 }}>
          <b>WebCodecs bench</b> · {count} decoders · {accel === 'prefer-hardware' ? 'HW' : 'SW'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(['prefer-hardware', 'prefer-software'] as const).map((a) => (
            <button key={a} onClick={() => setAccel(a)} style={{ ...btn, ...(a === accel ? btnOn : {}) }}>
              {a === 'prefer-hardware' ? 'hardware' : 'software'}
            </button>
          ))}
        </div>
        <div>render: <b style={{ color: hud.fps >= FPS - 1 ? '#7e7' : hud.fps >= FPS * 0.6 ? '#ee7' : '#e77' }}>{hud.fps} fps</b> (target {FPS})</div>
        <div>ready: {hud.ready}/{count} · worst lag: <b style={{ color: hud.worstLag <= 1 ? '#7e7' : hud.worstLag <= 4 ? '#ee7' : '#e77' }}>{hud.worstLag}f</b></div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[4, 8, 16, 32, 64, 96, 128].map((nn) => (
            <button key={nn} onClick={() => setCount(nn)} style={{ ...btn, ...(nn === count ? btnOn : {}) }}>{nn}</button>
          ))}
        </div>
        <div style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>green fps + 0–1f lag = sustained · red = decoder budget exceeded</div>
      </div>
    </div>
  )
}

const panel: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#111', color: '#e77', font: '14px ui-monospace, monospace' }
const hudBox: React.CSSProperties = { position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.6)', padding: '10px 12px', borderRadius: 8, backdropFilter: 'blur(4px)', pointerEvents: 'auto' }
const btn: React.CSSProperties = { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', font: 'inherit' }
const btnOn: React.CSSProperties = { background: '#c33', color: '#fff', borderColor: '#c33' }
