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
): Promise<{ config: VideoDecoderConfig; chunks: EncodedVideoChunk[]; w: number; h: number }> {
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
  return { config: config!, chunks, w, h }
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
  private decodeNext = 0 // index the decoder's next output will have
  private feedNext = 0 // next chunk index to feed
  private want = 0 // current target index (from the consumer)
  private closed = false
  private readonly AHEAD = 8 // decode up to this many frames past `want`
  private readonly BEHIND = 2 // keep this many frames before `want` (smooths tiny stalls)

  private constructor(fps: number) {
    this.fps = fps
  }

  static async create(url: string, fps = 24): Promise<StreamingClip> {
    const clip = new StreamingClip(fps)
    const { config, chunks, w, h } = await demux(url)
    clip.config = config
    clip.chunks = chunks
    clip.width = w
    clip.height = h
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
    this.decodeNext = 0
    this.feedNext = 0
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed) {
          frame.close()
          return
        }
        this.cache.set(this.decodeNext, frame)
        this.decodeNext++
        // evict frames that fell well behind the play head
        for (const [k, f] of this.cache) {
          if (k < this.want - this.BEHIND) {
            f.close()
            this.cache.delete(k)
          }
        }
        this.pump()
      },
      error: (e) => console.error('StreamingClip decode error:', e),
    })
    this.decoder.configure(this.config)
    this.pump()
  }

  private pump() {
    const dec = this.decoder
    if (!dec || this.closed) return
    // feed chunks while the decoder is within AHEAD of the target and its queue is shallow
    while (
      this.feedNext < this.chunks.length &&
      this.decodeNext + dec.decodeQueueSize <= this.want + this.AHEAD &&
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
    const minKey = this.cache.size ? Math.min(...this.cache.keys()) : this.decodeNext
    if (!this.cache.has(index) && index < minKey) {
      // backward jump (scrub-back or loop wrap) past what we still hold → restart from 0
      this.want = index
      this.startDecoder()
    } else {
      this.want = index
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
