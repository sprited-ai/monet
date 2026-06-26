# Voice latency — measured breakdown + the freebies (parked for Jin's ear)

_Autonomous measurement while Jin's AFK (2026-06-24, prod monet.sprited.ai, typical short reply).
The pipeline after the VAD calls end-of-turn: STT → Claude → TTS, all sequential._

## Measured (prod, `curl -w time_total`)
| stage | endpoint | time | note |
|---|---|---|---|
| STT | `/api/whisper` (Groq `whisper-large-v3-turbo`) | **~0.30s** | fast, not a bottleneck |
| Brain | `/api/chat` (Claude haiku, **full** completion) | **~1.32s** | biggest |
| Voice | `/api/tts` (ElevenLabs `eleven_multilingual_v2`, **full** mp3) | **~1.22s** | 2nd biggest |
| **total to first audio** | | **~2.84s** | + VAD end-of-turn (redemptionFrames) on top |

Plus the VAD's end-of-turn wait (`redemptionFrames: 12` ≈ ~0.4s of trailing silence before it
fires `onSpeechEnd`). So real perceived gap ≈ **~3.2s** from when you stop talking.

## Why it's slow: Claude + TTS are sequential and both wait for the *whole* output
TTS can't start until Claude's text exists; we wait for the FULL Claude completion, then the FULL
mp3. The two ~1.2–1.3s waits stack.

## The freebies, ranked (ALL need Jin's ear → parked)
1. **Streaming cascade (ceiling, ~1.6s saved).** Stream Claude; start TTS on the first *sentence*
   as it forms; play while the rest streams. First audio ≈ 0.3 (STT) + ~0.5 (Claude 1st clause) +
   ~0.4 (TTS of a short clause) ≈ **~1.2s**. Cost: (a) Claude must stream — but our reply is
   `{say, emotion, remember}` JSON, which doesn't stream cleanly; we'd move the spoken text to a
   leading plain string + a trailing `{emotion, remember}` (a **reply-format change** → verify her
   replies/memory still parse), and (b) **sentence-chunked TTS** can break her prosody (verify by
   ear). Both are exactly the "Jin's-ear-only" changes the AFK loop must not ship.
2. **ElevenLabs streaming endpoint (best ROI, ~0.7–0.9s saved).** `/v1/text-to-speech/{id}/stream`
   + play chunks as they arrive (Web Audio queue or MediaSource), instead of awaiting the full mp3.
   No reply-format change. But chunked playback's **sound** needs Jin's ear (gaps/artifacts?).
3. **TTS model → `eleven_flash_v2_5`** (~75ms TTFB vs multilingual_v2). Could nearly erase the TTS
   wait + halve cost. But it **changes her voice character** (identity) — Jin decides. `/api/tts`
   already reads `ELEVENLABS_TTS_MODEL`, so it's a one-env-var A/B when he's ready.
4. **Plain-text reply format** (drop the JSON wrapper; emotion via a separate cheap classify or a
   trailing tag). Slightly faster + makes (1) possible. Reply-format change → Jin verifies quality.
5. **VAD `redemptionFrames`** (currently 12, was nudged up to avoid mid-sentence cuts). Lower = snappier
   end-of-turn but risks cutting on a pause. ~30ms/frame → 12=~360ms, 8=~240ms. Tunable by feel
   (Jin's testing, not by ear-quality) — a safe knob, left at 12 for now (safety over speed).

## Recommendation
When Jin's back: **try #3 (flash model A/B — instant, env-only) and #2 (ElevenLabs streaming)** —
biggest wins for least structural risk; both just need him to confirm the sound. #1 (full cascade)
is the ceiling but is the most invasive (format + prosody). #5 is the only knob safe to tune
autonomously, and it's left conservative. Nothing here is shippable without his ear, so it's parked.
