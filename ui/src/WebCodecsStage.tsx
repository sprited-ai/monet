import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Mouth } from './scene/types'
import type { MouthMode } from './Stage'
import { decodeClip, webCodecsSupported, type DecodedClip } from './webcodecs/ClipDecoder'

// A WebCodecs-backed twin of <Stage> for ONE clip — proof that frame-exact mouth erase is
// possible (no <video>, no rVFC). The clip is decoded to a VideoFrame[] up front and the
// draw loop uploads frames[idx] while the erase uses the SAME idx, so the polygon can't
// drift from the picture. Single-texture (no A/B cross-dissolve yet); the shader's framing
// + stacked-alpha + analytic mouth erase mirror Stage exactly. See
// [[monet-webcodecs-mouth-compositing]].

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}`
const FS = `precision mediump float;varying vec2 uv;
uniform sampler2D t;uniform float fw;uniform float zoom;uniform float scl;uniform float fas;uniform float aspect;
uniform vec2 anc;uniform vec2 base;
uniform vec2 uMouth[16];uniform vec3 uSkin;uniform vec4 uBox;uniform float uHasMouth;uniform float uMargin;
float sdPoly(vec2 p, vec2 v[16]){
  float d=dot(p-v[0],p-v[0]); float s=1.0; vec2 vj=v[15];
  for(int i=0;i<16;i++){
    vec2 vi=v[i]; vec2 e=vj-vi; vec2 w=p-vi;
    vec2 b=w-e*clamp(dot(w,e)/dot(e,e),0.0,1.0);
    d=min(d,dot(b,b));
    bvec3 c=bvec3(p.y>=vi.y, p.y<vj.y, e.x*w.y>e.y*w.x);
    if(all(c)||all(not(c))) s=-s;
    vj=vi;
  }
  return s*sqrt(d);
}
void main(){
  float k=scl*zoom;
  vec2 u=vec2(anc.x+(uv.x-0.5)*aspect/(k*fas), anc.y+(uv.y-base.y)/k);
  if(u.x<0.0||u.x>1.0||u.y<0.0||u.y>1.0){ gl_FragColor=vec4(0.0); return; }
  vec3 rgb=texture2D(t,vec2(u.x,u.y*0.5)).rgb;
  if(uHasMouth>0.5 && u.x>uBox.x-uMargin && u.x<uBox.z+uMargin && u.y>uBox.y-uMargin && u.y<uBox.w+uMargin){
    float cover=1.0-smoothstep(uMargin-0.004,uMargin+0.004,sdPoly(u,uMouth));
    rgb=mix(rgb,uSkin,cover);
  }
  float a=texture2D(t,vec2(u.x,0.5+u.y*0.5)).r;
  float e=smoothstep(0.0,fw,u.x)*smoothstep(0.0,fw,1.0-u.x)*smoothstep(0.0,fw,u.y)*smoothstep(0.0,fw,1.0-u.y);
  gl_FragColor=vec4(rgb,a*e);
}`

type Props = {
  src: string
  scale?: number
  anchor?: [number, number]
  baseline?: [number, number]
  zoom?: number
  feather?: number
  mouth?: Mouth | null
  mouthMode?: MouthMode
  mouthMargin?: number // shader dilation/feather radius (u-space); bigger = covers more lip
  fps?: number
  scrub?: number | null
  onFrame?: (frame: number, total: number) => void
  onReady?: () => void
  style?: CSSProperties
}

export default function WebCodecsStage({
  src,
  scale = 1,
  anchor = [0.5, 0.92],
  baseline = [0.5, 0.92],
  zoom = 1,
  feather = 0.01,
  mouth = null,
  mouthMode = 'erase',
  mouthMargin = 0.012,
  fps = 24,
  scrub = null,
  onFrame,
  onReady,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading')

  // latest props for the loop (avoid re-running the GL effect on every prop change)
  const cur = useRef({ scale, anchor, baseline, zoom, feather, mouth, mouthMode, mouthMargin, fps })
  cur.current = { scale, anchor, baseline, zoom, feather, mouth, mouthMode, mouthMargin, fps }
  const scrubRef = useRef(scrub)
  scrubRef.current = scrub
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    if (!webCodecsSupported()) {
      setStatus('unsupported')
      return
    }
    const cv = canvasRef.current!
    const oc = overlayRef.current!
    const octx = oc.getContext('2d')
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true })
    if (!gl) {
      setStatus('error')
      return
    }
    const sh = (type: number, s: string) => {
      const o = gl.createShader(type)!
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
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]))
    const U = (n: string) => gl.getUniformLocation(pr, n)
    const uT = U('t'), uFw = U('fw'), uZoom = U('zoom'), uScl = U('scl'), uFas = U('fas'), uAspect = U('aspect')
    const uAnc = U('anc'), uBase = U('base'), uMouth = U('uMouth'), uSkin = U('uSkin'), uBox = U('uBox'), uHasMouth = U('uHasMouth'), uMargin = U('uMargin')
    gl.uniform1i(uT, 0)

    let cssW = 1, cssH = 1, dpr = 1, aspect = 1
    const sizeCanvas = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      cssW = cv.clientWidth || 1
      cssH = cv.clientHeight || 1
      const w = Math.max(1, Math.round(cssW * dpr))
      const h = Math.max(1, Math.round(cssH * dpr))
      if (cv.width !== w || cv.height !== h) cv.width = w
      if (cv.height !== h) cv.height = h
      cv.width = w
      cv.height = h
      oc.width = w
      oc.height = h
      aspect = w / h
    }
    sizeCanvas()
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(cv)
    window.addEventListener('resize', sizeCanvas)

    let clip: DecodedClip | null = null
    let cancelled = false
    let raf = 0
    let startMs = -1 // play-clock origin; -1 = (re)seed it
    let resumeIdx = 0 // frame to resume from after a scrub
    const polyBuf = new Float32Array(32)

    const project = (ux: number, uy: number, fas: number): [number, number] => {
      const c = cur.current
      const k = c.scale * c.zoom
      const sx = (0.5 + ((ux - c.anchor[0]) * (k * fas)) / aspect) * cssW
      const sy = (c.baseline[1] + (uy - c.anchor[1]) * k) * cssH
      return [sx, sy]
    }

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (!clip || clip.frames.length === 0) return
      const c = cur.current
      const total = clip.frames.length
      const fasV = clip.width / (clip.height / 2)

      let idx: number
      const sc = scrubRef.current
      if (sc != null) {
        idx = Math.max(0, Math.min(total - 1, Math.floor(sc)))
        resumeIdx = idx
        startMs = -1 // re-seed the clock so playback resumes from here
      } else {
        if (startMs < 0) startMs = now - (resumeIdx / c.fps) * 1000
        idx = Math.floor(((now - startMs) / 1000) * c.fps)
        idx = ((idx % total) + total) % total
      }

      const frame = clip.frames[idx]
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, frame)

      gl.viewport(0, 0, cv.width, cv.height)
      gl.uniform1f(uFw, Math.max(0.0001, c.feather))
      gl.uniform1f(uZoom, c.zoom)
      gl.uniform1f(uScl, c.scale)
      gl.uniform1f(uFas, fasV)
      gl.uniform1f(uAspect, aspect)
      gl.uniform2fv(uAnc, c.anchor)
      gl.uniform2fv(uBase, c.baseline)

      const mf = c.mouth?.frames?.[idx]
      let hasMouth = 0
      if (c.mouthMode === 'erase' && mf?.poly) {
        for (let i = 0; i < 16; i++) {
          polyBuf[i * 2] = mf.poly[i][0]
          polyBuf[i * 2 + 1] = mf.poly[i][1]
        }
        gl.uniform2fv(uMouth, polyBuf)
        gl.uniform3f(uSkin, mf.skin[0] / 255, mf.skin[1] / 255, mf.skin[2] / 255)
        gl.uniform4f(uBox, mf.box[0], mf.box[1], mf.box[2], mf.box[3])
        hasMouth = 1
      }
      gl.uniform1f(uHasMouth, hasMouth)
      gl.uniform1f(uMargin, c.mouthMargin)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // contour overlay (debug) — same frame idx, so it's locked too
      if (octx) {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0)
        octx.clearRect(0, 0, cssW, cssH)
        if (c.mouthMode === 'contour' && mf?.poly) {
          octx.lineWidth = 2
          octx.strokeStyle = 'rgba(255,70,170,0.95)'
          octx.beginPath()
          mf.poly.forEach(([ux, uy], i) => {
            const [sx, sy] = project(ux, uy, fasV)
            if (i === 0) octx.moveTo(sx, sy)
            else octx.lineTo(sx, sy)
          })
          octx.closePath()
          octx.stroke()
        }
      }
      onFrameRef.current?.(idx, total)
    }

    decodeClip(src, cur.current.fps)
      .then((c) => {
        if (cancelled) {
          c.close()
          return
        }
        clip = c
        setStatus('ready')
        onReadyRef.current?.()
        raf = requestAnimationFrame(draw)
      })
      .catch((e) => {
        console.error('WebCodecsStage decode failed:', e)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', sizeCanvas)
      clip?.close()
    }
  }, [src])

  return (
    <div style={{ position: 'relative', ...style }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
      {status !== 'ready' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#888', font: '13px ui-monospace, monospace' }}>
          {status === 'loading' && 'decoding clip…'}
          {status === 'unsupported' && 'WebCodecs not supported in this browser'}
          {status === 'error' && 'decode error (see console)'}
        </div>
      )}
    </div>
  )
}
