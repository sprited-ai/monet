// Frame-exact clip decoder (WebCodecs). Demuxes an mp4 with mp4box, then decodes EVERY
// frame up-front into a presentation-ordered VideoFrame[]. The player indexes that array
// directly, so the frame on screen and the frame index the mouth-erase uses are the SAME
// by construction — no <video> seek/compositor ±1 jitter (the reason erase desynced).
//
// Up-front decode caches the whole clip (~1.2 MB/frame). Fine for the desktop /preview
// validation; production streams instead (decode-as-you-go, ~1 frame live — see
// experiments/webcodecs-poc/streaming.html). See [[monet-webcodecs-mouth-compositing]].
import MP4Box from './mp4box.mjs'

export type DecodedClip = {
  frames: VideoFrame[] // presentation order; frames[i] === clip frame i
  fps: number
  width: number
  height: number
  close(): void
}

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

async function demux(url: string): Promise<{ config: VideoDecoderConfig; chunks: EncodedVideoChunk[]; w: number; h: number }> {
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

// Decode the whole clip into a presentation-ordered frame array.
export async function decodeClip(url: string, fps = 24): Promise<DecodedClip> {
  const { config, chunks, w, h } = await demux(url)
  const frames: VideoFrame[] = []
  let decErr: unknown = null
  const decoder = new VideoDecoder({
    output: (f) => frames.push(f),
    error: (e) => (decErr = e),
  })
  decoder.configure(config)
  for (const c of chunks) decoder.decode(c)
  await decoder.flush()
  decoder.close()
  if (decErr) throw decErr
  frames.sort((a, b) => a.timestamp - b.timestamp) // decode order → presentation order
  return {
    frames,
    fps,
    width: w,
    height: h,
    close() {
      for (const f of frames) {
        try {
          f.close()
        } catch {
          /* already closed */
        }
      }
      frames.length = 0
    },
  }
}
