import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

// Monet's stage: a stacked-alpha player with a TWO-texture shader so clip
// transitions cross-dissolve *in the shader* (rgb AND alpha mixed) over a few
// frames — no CSS-opacity double-transparency, and the tone jump at the seam
// melts across the blend. The previous clip holds its last frame while the next
// fades in over it. See docs/008-video-rendering.md.

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}`
// Per-slot scale + anchor normalize the character's on-screen size across framings
// (a bigger frame = more zoomed-out → scale>1 magnifies it back). The anchor (feet)
// is the fixed point so Monet stays grounded while scaling. `zoom` is a global user
// multiplier. Sampling outside the frame is transparent (no edge smear).
const FS = `precision mediump float;varying vec2 uv;
uniform sampler2D tA;uniform sampler2D tB;uniform float mixv;uniform float fw;uniform float zoom;
uniform vec2 ancA;uniform float sclA;uniform vec2 ancB;uniform float sclB;uniform vec2 base;uniform float aspect;
// anc = where the feet are in THIS clip's frame (per framing). base = the fixed
// screen point the feet sit at, same for every clip. The canvas matches the
// viewport rect (not the square frame); aspect = canvasW/canvasH keeps texels
// square (no distortion) and lets a wide viewport show MORE of the frame's sides
// instead of cropping them. Vertical fit drives scale; horizontal just fills the
// extra width. Feet land on the same screen baseline regardless of framing.
vec4 stk(sampler2D t,vec2 anc,float scl){
  float k=scl*zoom;
  vec2 u=vec2(anc.x+(uv.x-0.5)*aspect/k, anc.y+(uv.y-base.y)/k);
  if(u.x<0.0||u.x>1.0||u.y<0.0||u.y>1.0) return vec4(0.0);
  vec3 rgb=texture2D(t,vec2(u.x,u.y*0.5)).rgb;
  float a=texture2D(t,vec2(u.x,0.5+u.y*0.5)).r;
  // Feather on the VIDEO RECT (frame coords u), not the render box — content near
  // the clip's own frame border softens. A property of the video, so it follows
  // scale/zoom with the frame rather than the viewport.
  float e=smoothstep(0.0,fw,u.x)*smoothstep(0.0,fw,1.0-u.x)
        *smoothstep(0.0,fw,u.y)*smoothstep(0.0,fw,1.0-u.y);
  return vec4(rgb,a*e);
}
void main(){
  vec4 a=stk(tA,ancA,sclA), b=stk(tB,ancB,sclB);
  // Cross-dissolve in PREMULTIPLIED space: a transparent texel (a==0) carries
  // garbage rgb under it, so mixing straight-alpha drags i2's color toward that
  // garbage and only reaches alpha=mixv. Premultiplying makes a==0 contribute
  // nothing, so i2's true rgb fades in cleanly. Un-premultiply for the
  // straight-alpha buffer (premultipliedAlpha:false).
  vec4 m=mix(vec4(a.rgb*a.a,a.a), vec4(b.rgb*b.a,b.a), mixv);
  gl_FragColor = m.a>0.0001 ? vec4(m.rgb/m.a, m.a) : vec4(0.0);
}`

// Safari won't decode a display:none / visibility:hidden video, so a canvas fed by
// it stays blank. Keep the source element in the render tree but tiny + transparent.
const HIDDEN_VIDEO: CSSProperties = {
  position: 'absolute',
  width: 2,
  height: 2,
  opacity: 0,
  pointerEvents: 'none',
  top: 0,
  left: 0,
}

type Props = {
  src: string
  seq?: number // bumps every advance — re-runs the load effect even if src repeats
  scale?: number // framing render scale (regular = 1; large ≈ 1.3, etc.)
  anchor?: [number, number] // framing origin (feet) in the frame, normalized
  baseline?: [number, number] // fixed screen point the feet sit at, all clips
  zoom?: number // global user zoom multiplier
  onClipEnd?: () => void
  onPlaying?: () => void // fired once when playback actually starts (hide the poster)
  blendMs?: number
  feather?: number
  style?: CSSProperties
}

export default function Stage({
  src,
  seq = 0,
  scale = 1,
  anchor = [0.5, 0.87],
  baseline = [0.5, 0.87],
  zoom = 1,
  onClipEnd,
  onPlaying,
  blendMs = 150,
  feather = 0.04,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vRef = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  const active = useRef(0) // slot currently playing / shown (0 or 1)
  const mixVal = useRef(0) // 0 = slot0, 1 = slot1 (what the shader shows)
  const mixTarget = useRef(0)
  const mixFrom = useRef(0)
  const blendStart = useRef(0)
  const pending = useRef(-1) // slot a new clip is loading into (start blend when ready)
  const endedFired = useRef(false) // guard: fire onClipEnd once per clip (poll-based)
  const first = useRef(true)
  const playingFired = useRef(false) // fire onPlaying once, when the first frame shows
  const slotScale = useRef<[number, number]>([scale, scale]) // per-slot framing scale
  const slotAnchor = useRef<[[number, number], [number, number]]>([anchor, anchor])
  const cur = useRef({ scale, anchor, baseline, zoom }) // latest props for the loop
  cur.current = { scale, anchor, baseline, zoom }
  const onEnd = useRef(onClipEnd)
  onEnd.current = onClipEnd
  const onPlay = useRef(onPlaying)
  onPlay.current = onPlaying

  // GL setup + draw loop (two video textures, mixed by `mixv`).
  useEffect(() => {
    const cv = canvasRef.current!
    const a = vRef[0].current!
    const b = vRef[1].current!
    a.muted = true // imperative — React's `muted` attr doesn't reliably set the property
    b.muted = true
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true })
    if (!gl) return
    const sh = (t: number, s: string) => {
      const o = gl.createShader(t)!
      gl.shaderSource(o, s)
      gl.compileShader(o)
      return o
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
    const mkTex = () => {
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      // 1×1 placeholder so the texture is COMPLETE before a video frame arrives —
      // Safari renders the whole draw black if a bound sampler is incomplete (the
      // 2nd slot has no clip yet on the first play). Chrome tolerates it.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]))
      return t
    }
    gl.activeTexture(gl.TEXTURE0)
    const texA = mkTex()
    gl.activeTexture(gl.TEXTURE1)
    const texB = mkTex()
    gl.uniform1i(gl.getUniformLocation(pr, 'tA'), 0)
    gl.uniform1i(gl.getUniformLocation(pr, 'tB'), 1)
    gl.uniform1f(gl.getUniformLocation(pr, 'fw'), Math.max(0.0001, feather))
    const mixLoc = gl.getUniformLocation(pr, 'mixv')
    const zoomLoc = gl.getUniformLocation(pr, 'zoom')
    const ancALoc = gl.getUniformLocation(pr, 'ancA')
    const sclALoc = gl.getUniformLocation(pr, 'sclA')
    const ancBLoc = gl.getUniformLocation(pr, 'ancB')
    const sclBLoc = gl.getUniformLocation(pr, 'sclB')
    const baseLoc = gl.getUniformLocation(pr, 'base')
    const aspectLoc = gl.getUniformLocation(pr, 'aspect')
    gl.disable(gl.BLEND) // single quad written straight; browser composites the canvas

    // Size the backing buffer to the DISPLAY rect (not the clip's 640² frame), so a
    // wide viewport renders wide and shows the frame's sides instead of cropping to a
    // square. dpr-aware for crispness; `aspect` feeds the shader.
    let aspect = 1
    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(cv.clientWidth * dpr))
      const h = Math.max(1, Math.round(cv.clientHeight * dpr))
      if (cv.width !== w || cv.height !== h) {
        cv.width = w
        cv.height = h
      }
      aspect = w / h
    }
    sizeCanvas()
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(cv)
    window.addEventListener('resize', sizeCanvas)

    let raf = 0
    const draw = (now: number) => {
      // Start a pending transition once the incoming clip actually has a frame
      // (readyState-driven, not event-driven — 'playing' was unreliable and could
      // leave `active` stale, which dropped the next clip's onClipEnd and froze).
      if (pending.current >= 0) {
        const pv = vRef[pending.current].current
        if (pv && pv.readyState >= 2) {
          mixFrom.current = mixVal.current
          mixTarget.current = pending.current
          blendStart.current = now
          active.current = pending.current
          pending.current = -1
          endedFired.current = false // new clip is now active — allow its end to fire
        }
      }
      // Poll for the active clip ending (Safari drops 'ended'/'playing' events
      // intermittently → the loop would freeze). Fire onClipEnd once per clip.
      if (pending.current < 0 && !endedFired.current) {
        const av = active.current === 0 ? a : b
        if (av.ended || (av.duration > 0 && av.currentTime >= av.duration - 0.05)) {
          endedFired.current = true
          onEnd.current?.()
        }
      }
      // ease the blend toward its target
      if (mixVal.current !== mixTarget.current) {
        const t = Math.min(1, (now - blendStart.current) / blendMs)
        const e = t * t * (3 - 2 * t)
        mixVal.current = t >= 1 ? mixTarget.current : mixFrom.current + (mixTarget.current - mixFrom.current) * e
      }
      if (a.readyState >= 2) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texA)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, a)
      }
      if (b.readyState >= 2) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, texB)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, b)
      }
      gl.viewport(0, 0, cv.width, cv.height)
      gl.uniform1f(mixLoc, mixVal.current)
      gl.uniform1f(zoomLoc, cur.current.zoom)
      gl.uniform2fv(baseLoc, cur.current.baseline)
      gl.uniform1f(aspectLoc, aspect)
      gl.uniform2fv(ancALoc, slotAnchor.current[0])
      gl.uniform1f(sclALoc, slotScale.current[0])
      gl.uniform2fv(ancBLoc, slotAnchor.current[1])
      gl.uniform1f(sclBLoc, slotScale.current[1])
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (!playingFired.current) {
        const av = active.current === 0 ? a : b
        if (av.readyState >= 2 && av.currentTime > 0) {
          playingFired.current = true
          onPlay.current?.()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', sizeCanvas)
    }
  }, [])

  // Load a new clip into the inactive slot and cross-dissolve to it. Keyed on `seq`
  // (not `src`) so it re-runs on every advance even if the random pick repeats a clip.
  useEffect(() => {
    if (first.current) {
      first.current = false
      slotScale.current[0] = cur.current.scale
      slotAnchor.current[0] = cur.current.anchor
      const v = vRef[0].current!
      v.src = src
      v.load() // Safari needs an explicit load() after setting src
      v.play().catch(() => {})
      return
    }
    const incoming = 1 - active.current
    slotScale.current[incoming] = cur.current.scale // this clip's framing scale/anchor
    slotAnchor.current[incoming] = cur.current.anchor
    const v = vRef[incoming].current!
    v.src = src
    v.load() // Safari won't refetch a reused (ended) element on a bare src swap → froze
    v.play().catch(() => {})
    pending.current = incoming // the draw loop blends to it once it's decoding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])

  return (
    <>
      {/* Not display:none — Safari won't decode a display:none video (canvas stays
          blank). Render it tiny + transparent so frames keep flowing to the texture. */}
      <video ref={vRef[0]} muted playsInline preload="auto" style={HIDDEN_VIDEO} />
      <video ref={vRef[1]} muted playsInline preload="auto" style={HIDDEN_VIDEO} />
      <canvas ref={canvasRef} style={style} />
    </>
  )
}
