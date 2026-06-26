// Frame-exact clip decoder (WebCodecs). Demuxes an mp4 with mp4box, then STREAMS frames:
// decodes just ahead of the play/scrub head and closes frames as they fall behind, so only
// a handful of VideoFrames (~a few MB) are ever live. The player indexes decoded frames
// directly, so the frame on screen and the index the mouth-erase uses are the SAME — no
// <video> seek/compositor ±1 jitter (the reason erase desynced).
//
// Why streaming and not decode-all: keeping every frame alive (~1.2 MB each → ~150 MB for a
// 121-frame clip) overflows a MOBILE decoder's output-buffer pool — it stalls (can't decode
// more until frames are freed) and flush() never resolves ("decoding clip…" forever on
// Android). Streaming + close() keeps it tiny. See [[monet-webcodecs-mouth-compositing]] and
// experiments/webcodecs-poc/streaming.html.
import MP4Box from './mp4box.mjs'

export function webCodecsSupported(): boolean {
  return typeof window !== 'undefined' && 'VideoDecoder' in window
}

// Pull the codec config box (avcC/hvcC/…) out of the track and serialize it for
// VideoDecoder.configure({ description }).
function getDescription(file: any, track: any): Uint8Array {
  const trak = file.getTrackById(track.id)
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C
    if (box) {
      const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN)
      box.write(stream)
      return new Uint8Array(stream.buffer, 8) // strip the 8-byte box header
    }
  }
  throw new Error('ClipDecoder: no codec description box (avcC/hvcC/…) in track')
}

async function demux(
  url: string,
): Promise<{ config: VideoDecoderConfig; chunks: EncodedVideoChunk[]; w: number; h: number; baseTs: number }> {
  const file = MP4Box.createFile()
  const chunks: EncodedVideoChunk[] = []
  let config: VideoDecoderConfig | null = null
  let w = 0
  let h = 0
  const done = new Promise<void>((resolve, reject) => {
    file.onError = (e: string) => reject(new Error('ClipDecoder demux: ' + e))
    file.onReady = (info: any) => {
      const track = info.videoTracks[0]
      if (!track) return reject(new Error('ClipDecoder: no video track'))
      w = track.video.width
      h = track.video.height
      config = { codec: track.codec, codedWidth: w, codedHeight: h, description: getDescription(file, track) }
      file.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples })
      file.onSamples = (_id: number, _user: unknown, samples: any[]) => {
        for (const s of samples) {
          chunks.push(
            new EncodedVideoChunk({
              type: s.is_sync ? 'key' : 'delta',
              timestamp: (s.cts / s.timescale) * 1e6,
              duration: (s.duration / s.timescale) * 1e6,
              data: s.data,
            }),
          )
        }
        if (chunks.length >= track.nb_samples) resolve()
      }
      file.start()
    }
  })
  const buf = (await (await fetch(url)).arrayBuffer()) as ArrayBuffer & { fileStart?: number }
  buf.fileStart = 0
  file.appendBuffer(buf)
  file.flush()
  await done
  // Frame 0's presentation timestamp is often NOT 0 — H.264 with B-frames carries an initial
  // cts offset (= reorder depth) so dts stays ≥ 0. Subtract it so index 0 = the first picture,
  // matching the mouth.json's 0-based numbering. (Indexing by absolute timestamp shifted every
  // frame by that offset → the erase rode N frames ahead of the body.)
  const baseTs = chunks.length ? Math.min(...chunks.map((c) => c.timestamp)) : 0
  return { config: config!, chunks, w, h, baseTs }
}

// A streaming, frame-exact clip. `frameAt(i)` (called once per rAF) drives decoding toward
// frame i and returns the frame actually on hand + its index, keeping memory to a small
// window. Our clips are single-GOP (one keyframe), so any decode starts at 0; sequential
// PLAYBACK is the natural order (cheap), and a backward jump (scrub-back / loop wrap)
// restarts the decoder from 0.
export class StreamingClip {
  fps: number
  width = 0
  height = 0
  total = 0
  private chunks: EncodedVideoChunk[] = []
  private config!: VideoDecoderConfig
  private decoder: VideoDecoder | null = null
  private cache = new Map<number, VideoFrame>()
  private baseTs = 0 // first frame's presentation timestamp (µs) — subtracted so index 0 = first picture
  private feedNext = 0 // next chunk index to feed
  private want = 0 // current target index (from the consumer)
  private closed = false
  private errored = false // decoder hit a hard error (codec now closed) — stop feeding it
  private label = '' // clip url, for error messages
  private readonly AHEAD = 8 // decode up to this many frames past `want`
  private readonly BEHIND = 2 // keep this many frames before `want` (smooths tiny stalls)

  private constructor(fps: number) {
    this.fps = fps
  }

  // True once at least one frame is decoded and on hand (the decoder starts pumping from
  // frame 0 in startDecoder, so this flips shortly after create()). Used to gate a clip
  // transition on the incoming clip actually having a picture.
  get ready(): boolean {
    return this.cache.size > 0
  }

  static async create(
    url: string,
    fps = 24,
    hwAccel?: VideoDecoderConfig['hardwareAcceleration'],
  ): Promise<StreamingClip> {
    const clip = new StreamingClip(fps)
    clip.label = url
    const { config, chunks, w, h, baseTs } = await demux(url)
    clip.config = config
    // Set once on the config; startDecoder() reconfigures from this.config on every restart,
    // so the hint persists across loop-wrap decoder restarts without a separate field.
    if (hwAccel) clip.config.hardwareAcceleration = hwAccel
    clip.chunks = chunks
    clip.width = w
    clip.height = h
    clip.baseTs = baseTs
    clip.total = chunks.length
    clip.startDecoder()
    return clip
  }

  private startDecoder() {
    try {
      this.decoder?.close()
    } catch {
      /* not configured */
    }
    for (const f of this.cache.values()) f.close()
    this.cache.clear()
    this.feedNext = 0
    this.errored = false
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed) {
          frame.close()
          return
        }
        // Index by PRESENTATION timestamp, NOT output order. Decoders emit B-frames in
        // DECODE order (Safari does — Chrome happened to reorder to presentation), so
        // output-order indexing jumbled playback (the "1 3 2 4 3 5" tic). timestamp is the
        // chunk cts we set, in µs → round to the frame index.
        const i = Math.round(((frame.timestamp - this.baseTs) / 1e6) * this.fps)
        this.cache.get(i)?.close() // replace if we somehow re-decoded this index
        this.cache.set(i, frame)
        // evict frames that fell well behind the play head
        for (const [k, f] of this.cache) {
          if (k < this.want - this.BEHIND) {
            f.close()
            this.cache.delete(k)
          }
        }
        this.pump()
      },
      // A hard decode error closes the codec. Mark it dead so pump() stops feeding (else every
      // rAF calls decode() on a closed codec → "Cannot call decode on a closed codec" throw that
      // is uncaught in the draw loop and spams forever). The cell just freezes on its last frame.
      error: (e) => {
        this.errored = true
        console.error(`StreamingClip decode error [${this.label}]:`, e)
      },
    })
    this.decoder.configure(this.config)
    this.pump()
  }

  private pump() {
    const dec = this.decoder
    // Guard the decoder STATE, not just our own closed flag: after a decode error the codec is
    // 'closed' and decode() throws. (this.closed is only the consumer closing the clip.)
    if (!dec || this.closed || this.errored || dec.state !== 'configured') return
    // Feed chunks (decode order) until we've supplied roughly want+AHEAD frames and the
    // decoder's in-flight queue is shallow. chunk index ≈ presentation index ± B-frame
    // reorder (a few), so this keeps the window around `want` populated.
    while (
      this.feedNext < this.chunks.length &&
      this.feedNext <= this.want + this.AHEAD &&
      dec.decodeQueueSize < 4
    ) {
      dec.decode(this.chunks[this.feedNext++])
    }
  }

  // Drive decoding toward `index` and return the frame to show (exact if ready, else the
  // nearest earlier cached frame) plus the index that frame actually is — so overlays can
  // lock to what's on screen, not to the requested index, during brief catch-up.
  frameAt(index: number): { frame: VideoFrame; index: number } | null {
    if (this.total === 0) return null
    index = ((index % this.total) + this.total) % this.total
    this.want = index
    // Backward jump (scrub-back or loop wrap) past everything we still hold → the frame can
    // only be reached by decoding from the keyframe again (single-GOP) → restart from 0.
    if (!this.errored && this.cache.size > 0 && !this.cache.has(index) && index < Math.min(...this.cache.keys())) {
      this.startDecoder()
    } else {
      this.pump()
    }
    const exact = this.cache.get(index)
    if (exact) return { frame: exact, index }
    // nearest earlier available frame (avoids a black flash while catching up)
    let best: VideoFrame | null = null
    let bestK = -1
    for (const [k, f] of this.cache) {
      if (k <= index && k > bestK) {
        bestK = k
        best = f
      }
    }
    return best ? { frame: best, index: bestK } : null
  }

  close() {
    this.closed = true
    try {
      this.decoder?.close()
    } catch {
      /* */
    }
    for (const f of this.cache.values()) f.close()
    this.cache.clear()
  }
}

// What the renderer consumes: a StreamingClip (mouth-exact, evicts behind the head) OR a
// LoopClip (a short clip prebaked to bitmaps for a smooth loop). Same frame-fetch interface.
export interface ClipSource {
  readonly total: number
  readonly ready: boolean
  readonly width: number
  readonly height: number
  frameAt(index: number): { frame: VideoFrame | ImageBitmap; index: number } | null
  close(): void
}

// A SHORT clip prebaked to ImageBitmaps, for seamless looping on mobile. Decodes every frame
// once, converting each VideoFrame to an ImageBitmap and closing the VideoFrame immediately —
// so the decoder's small output-frame pool never fills (the reason StreamingClip streams), yet
// every frame stays resident, so a forward loop wraps with NO decoder restart (a restart hitches
// each cycle on Android). Use ONLY for short clips (a boomerang, ~tens of frames): N bitmaps are
// held for the clip's life. No backward-scrub / mouth-erase concerns here — just looping.
export class LoopClip implements ClipSource {
  width = 0
  height = 0
  total = 0
  private bitmaps: (ImageBitmap | null)[] = []
  private closed = false

  get ready(): boolean {
    return this.bitmaps.length > 0 && this.bitmaps[0] != null
  }

  static async create(url: string, fps = 24): Promise<LoopClip> {
    const clip = new LoopClip()
    const { config, chunks, w, h, baseTs } = await demux(url)
    clip.width = w
    clip.height = h
    clip.total = chunks.length
    clip.bitmaps = new Array(chunks.length).fill(null)
    let fed = 0
    let inflight = 0 // VideoFrames decoded but not yet converted+closed — capped to spare the pool
    let done = 0
    let flushed = false
    await new Promise<void>((resolve, reject) => {
      const decoder = new VideoDecoder({
        output: (frame) => {
          const i = Math.round(((frame.timestamp - baseTs) / 1e6) * fps)
          inflight++
          createImageBitmap(frame)
            .then((bm) => {
              frame.close()
              inflight--
              if (i >= 0 && i < clip.total && !clip.closed) clip.bitmaps[i] = bm
              else bm.close()
              done++
              if (done >= clip.total) resolve()
              else feed()
            })
            .catch((err) => {
              frame.close()
              reject(err)
            })
        },
        error: reject,
      })
      decoder.configure(config)
      const feed = () => {
        while (fed < chunks.length && inflight < 6 && decoder.state === 'configured' && decoder.decodeQueueSize < 4) {
          decoder.decode(chunks[fed++])
        }
        if (fed >= chunks.length && !flushed && decoder.state === 'configured') {
          flushed = true
          decoder.flush().catch(() => {})
        }
      }
      feed()
    })
    return clip
  }

  frameAt(index: number): { frame: ImageBitmap; index: number } | null {
    if (this.total === 0) return null
    const i = ((index % this.total) + this.total) % this.total
    const bm = this.bitmaps[i]
    return bm ? { frame: bm, index: i } : null
  }

  close() {
    this.closed = true
    for (const b of this.bitmaps) b?.close()
    this.bitmaps = []
  }
}
