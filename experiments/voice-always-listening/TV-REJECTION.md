# Rejecting the background talker (TV/Netflix) — the real path

_Context: Approach A (Silero VAD → Groq Whisper) shipped to the whiteroom (2026-06-24). It
works, but Silero is a **raw VAD** — it fires on ANY voice, so a TV/Netflix talker during your
silence triggers a phantom turn. This is the one real gap. Below: what we tried, why the
obvious fix is a dead end, and the path that actually works._

## What we observed
- **Whisper ignores a quieter *simultaneous* TV** (you talking over the TV → it transcribes you). Verified headless: Jin 1.0 + TV 0.4 mix → only Jin's line came back.
- **A TV-alone clip (you silent) → Whisper transcribes the TV.** That's the phantom. The fix must stop TV-alone audio from ever reaching Whisper — i.e. the **gate** must reject non-Jin speech.
- **Vanilla Web Speech API rejects the TV beautifully** (Jin tested: Netflix nurses/actors talking, none of it registered). A real ASR focuses on the primary/near speaker. That's the capability Silero lacks.

## Why "Web Speech as the gate" is a dead end (on macOS)
We tried: Web Speech as the gate (it rejects TV) + a parallel `getUserMedia` worklet to capture
the audio for Whisper. The mic went **dead** — orb stopped reacting, every clip read as "no
speech". Root cause (researched):
- **Web Speech exposes no audio** — only text + `onspeechstart/end`. So you always need a *second* capture for Whisper. ([W3C speech-api #66](https://github.com/w3c/speech-api/issues/66) is the open request to let SpeechRecognition take a `MediaStreamTrack` — not supported.)
- **Two simultaneous audio captures conflict** — WebKit/Safari "does not allow asking for several audio streams simultaneously; each `getUserMedia` ends the previous track" ([webrtc-developers](https://www.webrtc-developers.com/how-to-know-if-my-microphone-works/)). Web Speech's internal getUserMedia ends ours → silence. macOS Chrome behaves the same in our test.
- `/voice/b.html` keeps this experiment with a `[mic] MUTED` diagnostic — one test on Jin's mic will confirm the track mutes on `rec.start()`, validating the pivot. But it's almost certainly not viable on his platform.

→ **Don't add a second mic. Process our single stream with a model.**

## The path that works: personalized VAD on one stream (Picovoice)
[Cobra VAD](https://picovoice.ai/platform/cobra/) + [Eagle Speaker Recognition](https://picovoice.ai/products/voice/speaker-recognition/) — both in-browser WASM, on-device (no server, no second mic, no Web Speech conflict), **free AccessKey** (trial, no card).
- **Cobra VAD** alone is a strict upgrade over Silero: **98.9% TPR @ 5% FPR @ 0 dB SNR vs Silero 87.7%** — far better in noise, so fewer TV misfires even before speaker-ID.
- **Eagle** enrolls a speaker in seconds from natural speech (no passphrase), identifies in real time, **0.18% EER** (best-in-class), fully on-device.
- **Eagle + Cobra = personalized VAD: "detect speech from a SPECIFIC speaker"** → only Jin's voice opens the gate; TV/other talkers are ignored. This is BOTH the TV-rejection fix AND the "she recognizes you" moat (docs/015).

### Packages (confirmed) + the SharedArrayBuffer gotcha
- **`@picovoice/cobra-web`** (VAD) and **`@picovoice/eagle-web`** (speaker recog: `EagleWorker` + `EagleProfilerWorker` for enrollment) both exist as browser WASM SDKs.
- **⚠ `@picovoice/eagle-web` requires `SharedArrayBuffer` → the page must send COOP/COEP headers** (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`). That **cross-origin-isolates** the page, which can BREAK cross-origin loads that lack CORP: our CDN-loaded Silero/ort, ElevenLabs audio fetch, `/contents` media, etc. Non-trivial — every cross-origin resource needs `crossorigin` + a CORP header, or must be same-origin. This is the real cost of in-browser Eagle.

### Two-step plan (lower lift first)
1. **Step 1 — swap Silero → Cobra VAD** (no enrollment, likely no SharedArrayBuffer/COOP-COEP — *verify*). Strict noise upgrade (98.9% vs 87.7% TPR @0dB) → fewer TV misfires immediately, drop-in for the gate in `createHandsFree()`. Needs only a free AccessKey.
2. **Step 2 — add Eagle for true speaker-ID** (the moat). Enroll Jin once (~20s via `EagleProfilerWorker` → profile in localStorage, per-device like `monet.uid`). Runtime: Cobra (is-speech) + Eagle (is-it-Jin) → gate opens only when *Jin* speaks → buffer → `/api/whisper`. Pay the COOP/COEP cost here; isolate it to the whiteroom route + add CORP/crossorigin to every external resource. Keep Silero as the pre-enrollment fallback.

Blocked on: a Picovoice AccessKey (Jin, free, no card) + an enrollment recording (Jin's voice).
Can't be built/verified headless. Build Step 1 first on his return (smaller, reversible); Step 2
once Step 1 proves Cobra's noise-rejection helps and the COOP/COEP isolation is worth it.

## Cheaper stopgaps available today
- **macOS Voice Isolation** (Control Center → Mic Mode) — ML near-field speaker focus, kills TV, free, applies to Chrome. The zero-code mitigation for now.
- **Krisp BVC** (Background Voice Cancellation, WASM in an AudioWorklet on our stream) — turnkey background-*voice* removal, but went **paid** May 2026. The commercial alternative to Eagle+Cobra.

## Recommendation
Build **Cobra + Eagle personalized VAD** as "Approach C" — it's the only path that both rejects
the TV AND gives the recognizes-you moat, with no mic conflict and a free key. Until then, A
(Silero) ships, and macOS Voice Isolation is the stopgap.
