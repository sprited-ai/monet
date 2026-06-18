import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

// Renders a stacked-alpha H.264 (color top / alpha-as-luma bottom) as a
// transparent WebGL canvas. See docs/008-video-rendering.md.
//
// The canvas is sized to the COLOR region (videoWidth × videoHeight/2) so any
// aspect ratio composites correctly. onReady fires once playback actually starts
// (so callers can keep a poster visible until then — no flicker).

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}`
// Edge feather: fade alpha to 0 within `fw` of each frame edge, so sprites/effects
// that reach the boundary soften out instead of hard-clipping.
const FS = `precision mediump float;varying vec2 uv;uniform sampler2D t;uniform float fw;
void main(){vec3 rgb=texture2D(t,vec2(uv.x,uv.y*0.5)).rgb;
float a=texture2D(t,vec2(uv.x,0.5+uv.y*0.5)).r;
float e=smoothstep(0.0,fw,uv.x)*smoothstep(0.0,fw,1.0-uv.x)*smoothstep(0.0,fw,uv.y)*smoothstep(0.0,fw,1.0-uv.y);
gl_FragColor=vec4(rgb,a*e);}`

type Props = {
  src: string
  loop?: boolean
  autoPlay?: boolean
  muted?: boolean
  onEnded?: () => void
  onReady?: () => void
  feather?: number // edge feather width, fraction of frame (0 = off)
  style?: CSSProperties
  className?: string
}

export default function StackedVideo({
  src,
  loop = false,
  autoPlay = false,
  muted = true,
  onEnded,
  onReady,
  feather = 0.04,
  style,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vRef = useRef<HTMLVideoElement>(null)

  // GL compositor — set up once; draws whatever the <video> currently shows.
  useEffect(() => {
    const cv = canvasRef.current!
    const v = vRef.current!
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true })
    if (!gl) return
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
    gl.uniform1f(gl.getUniformLocation(pr, 'fw'), Math.max(0.0001, feather))
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

    // Size the canvas buffer to the stacked clip's color region (top half).
    const sizeCanvas = () => {
      if (v.videoWidth) {
        cv.width = v.videoWidth
        cv.height = Math.max(1, Math.floor(v.videoHeight / 2))
      }
    }
    sizeCanvas()
    v.addEventListener('loadedmetadata', sizeCanvas)

    let raf = 0
    const draw = () => {
      if (v.readyState >= 2) {
        gl.viewport(0, 0, cv.width, cv.height)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('loadedmetadata', sizeCanvas)
    }
  }, [])

  // Playback + events.
  useEffect(() => {
    const v = vRef.current!
    if (autoPlay) v.play().catch(() => {})
    const playing = () => onReady?.()
    v.addEventListener('playing', playing)
    if (onEnded) v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('playing', playing)
      if (onEnded) v.removeEventListener('ended', onEnded)
    }
  }, [src, autoPlay, onReady, onEnded])

  return (
    <>
      <video
        ref={vRef}
        src={src}
        muted={muted}
        loop={loop}
        autoPlay={autoPlay}
        playsInline
        preload="auto"
        style={{ display: 'none' }}
      />
      <canvas ref={canvasRef} style={style} className={className} />
    </>
  )
}
