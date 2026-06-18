import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

// Renders a stacked-alpha H.264 (color top / alpha-as-luma bottom) as a
// transparent WebGL canvas. See docs/008-video-rendering.md.
//
// Playback is controlled via the underlying <video>: autoPlay tries immediately
// (works once the session is unlocked by any gesture); otherwise call play()
// after a user gesture. onEnded fires when a non-looping clip finishes.

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}`
const FS = `precision mediump float;varying vec2 uv;uniform sampler2D t;
void main(){vec3 rgb=texture2D(t,vec2(uv.x,uv.y*0.5)).rgb;
float a=texture2D(t,vec2(uv.x,0.5+uv.y*0.5)).r;gl_FragColor=vec4(rgb,a);}`

type Props = {
  src: string
  width?: number
  height?: number
  loop?: boolean
  autoPlay?: boolean
  muted?: boolean
  onEnded?: () => void
  videoRef?: (el: HTMLVideoElement | null) => void
  style?: CSSProperties
  className?: string
}

export default function StackedVideo({
  src,
  width = 640,
  height = 640,
  loop = false,
  autoPlay = false,
  muted = true,
  onEnded,
  videoRef,
  style,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vRef = useRef<HTMLVideoElement>(null)

  // GL compositor — set up once, drives off whatever the <video> is showing.
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

  // onEnded subscription
  useEffect(() => {
    const v = vRef.current!
    if (!onEnded) return
    v.addEventListener('ended', onEnded)
    return () => v.removeEventListener('ended', onEnded)
  }, [onEnded])

  return (
    <>
      <video
        ref={(el) => {
          vRef.current = el
          videoRef?.(el)
        }}
        src={src}
        muted={muted}
        loop={loop}
        autoPlay={autoPlay}
        playsInline
        preload="auto"
        style={{ display: 'none' }}
      />
      <canvas ref={canvasRef} width={width} height={height} style={style} className={className} />
    </>
  )
}
