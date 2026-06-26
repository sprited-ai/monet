# Realtime Voice for Monet — a Claude-Brained Cascade That Feels Like Advanced Voice Mode

> Deep-research report (fan-out web search → 27 sources → 133 claims → 25 verified by 3-vote
> adversarial check → 22 confirmed, 3 refuted). Generated 2026-06-24.
> Constraint: Monet's brain MUST be Claude, so the architecture is a **cascade**
> (streaming ASR → Claude streaming → streaming TTS, WebRTC, server VAD + barge-in).
> Companion docs: `ECHO-CANCELLATION.md`, `RESEARCH.md`, `OOV-VOCABULARY.md`.

## Executive summary

A well-engineered **cascade** (streaming ASR → Claude streaming → low-latency TTS, over WebRTC,
with server VAD + barge-in) can land in the **~700ms–1.1s** mic-to-first-audio range and *feel*
close to ChatGPT Advanced Voice Mode for a turn-based chat — the gap that remains is paralinguistic
(emotion/tone carried in audio tokens), which a text cascade structurally cannot recover
(openai.com, high). The recommended build is **Pipecat** (because it ships a first-class
`AnthropicLLMService` so Claude is the brain, plus a local open-source semantic turn detector)
wired to **Deepgram** streaming ASR, **Cartesia Sonic** TTS, **Picovoice Eagle** for in-browser
enroll-once speaker ID, and a **frequency-band AudioWorklet lip-sync** engine for the chibi mouth.
The cheaper fallback swaps to **faster-whisper + Deepgram Aura + the same browser primitives**. The
single biggest perceived-latency lever is hitting Claude's TTFT and starting TTS on the first
sentence; the biggest *product* risk is speaker-ID false-accepts in noise (recognition ≠ true
target-speaker extraction).

---

## 1. Architecture: how close can a cascade get, and the latency budget

**Verdict: close enough for a turn-based living-agent chat, with a real but bounded gap.** OpenAI's
native speech-to-speech (GPT-4o Realtime) ingests audio tokens and emits audio tokens directly,
which "eliminate[s] the transduction loss and latency overhead of intermediate text conversion" a
cascade incurs (openai.com, **high**). That is an architectural fact, not a benchmark — the cost of
the cascade is (a) accumulated handoff latency and (b) loss of paralinguistic signal (the model
never *hears* tone; it reads text). For Monet — a character whose voice you control via TTS anyway —
(b) matters less than for a general assistant, because you're not trying to mirror the *user's*
emotion back, you're performing a fixed character.

Note: the stronger claim that cascades have an "inherent latency floor above 2 seconds" was
**refuted** (0-3) — that is not true of a tuned 2025-2026 cascade.

**Realistic end-to-end budget (mic → first audio out):**

| Stage | Budget | Source / confidence |
|---|---|---|
| Audio preprocessing (AEC, denoise) | 25–50ms | cresta.com, **high** |
| Streaming ASR (≤50ms chunks) | 200–300ms | cresta.com, **high** |
| Turn/end-of-turn detection | adds on top of ASR final (see §6) | — |
| Claude TTFT (first token) | 250ms–1s+ (use a fast model; reasoning models are too slow for the live loop) | cresta.com, **high** |
| TTS time-to-first-audio | 100–500ms (best models ~150–260ms) | cresta.com, **high**; coval, **high** |
| **Total mic→first-audio** | **~700ms–1.1s achievable; ~575ms floor** | derived, **high** |

**How to hit sub-1s:**
- Use ≤50ms ASR chunks for 200–300ms ASR latency (cresta.com, **high**).
- Pick a **fast** Claude tier for the live loop (Haiku-class TTFT ~250–400ms). Reasoning models
  "generally can't be used within the live response loop — they are too slow" (cresta.com, **high**).
  If you want deliberation, run it *async* and speak a canned/short bridging phrase live
  (industry-standard pattern).
- **Start TTS on the first sentence/clause of Claude's stream**, not on completion — this is the
  single biggest lever; it hides Claude's full generation behind the first audio chunk.
- Choose a TTS with sub-300ms TTFA: Cartesia Sonic-3 P50 **188ms**, ElevenLabs Turbo v2.5 **264ms**,
  Deepgram Aura-2 **313ms** (coval, **high**).
- Why sub-1s matters: pauses as short as **~300ms feel unnatural**, and **latency beyond ~1.5s
  rapidly degrades** the experience (cresta.com, **high**; corroborated by Stivers et al. 2009 PNAS
  — human median inter-turn gap ~200ms).

---

## 2. Frameworks: Pipecat vs LiveKit Agents vs Vapi vs roll-your-own

**Recommendation: Pipecat.** The decisive fact for Monet's hard constraint (brain MUST be Claude) is
that Pipecat ships a **first-class `AnthropicLLMService`** that integrates Claude "supporting
streaming responses, function calling, and prompt caching" (docs.pipecat.ai, **high**). That
directly confirms the ASR→Claude→TTS cascade is a supported, maintained path (current config example
uses `claude-sonnet-4-5-20250929`), not a hack.

Pipecat also gives you the turn-detection piece in-house: **Smart Turn v2**, an open-source
semantic-VAD model that runs locally via `LocalSmartTurnAnalyzerV2` (v0.0.77+) or hosted via
`FalSmartTurnAnalyzer`, with weights/training-code/datasets published (daily.co, **high**). Inference
is **12ms on an L40S** but **410ms–6,272ms on CPU** (daily.co, **high**) — so on a server GPU it's
free latency, on CPU it's a real budget item (see §6). Note v3 now exists and v0.0.77's class is
deprecated in favor of `LocalSmartTurnAnalyzerV3` — pin deliberately.

**LiveKit Agents** is the strong alternative and arguably better on the WebRTC transport layer
(LiveKit *is* the media server). Its **`TurnDetector`** is an audio model encoding "intonation,
pitch, and rhythm... without relying on a transcript," usable even alongside a realtime model with no
STT plugin (docs.livekit.io, **high**). It ships **v1** (full, free on LiveKit Cloud) and **v1-mini**
(runs locally on CPU, free in any context, **<500 MB RAM**) (docs.livekit.io, **medium** — 2-1 vote;
one GitHub issue reports a ~1GB memory regression in agents v1.3.12, a version bug not a spec
refutation). LiveKit supports custom LLMs too, so Claude works — but the Anthropic path is less
explicitly first-class than Pipecat's documented service.

**Vapi** is hosted/managed — fastest to a demo, but it's the wrong fit here: you need a **custom
frontend** (the chibi renderer + viseme stream), in-browser speaker-ID hooks, and full control of the
turn loop. That argues against a hosted black box and toward self-host.

**Roll-your-own**: you already have a hand-built VAD + browser AEC3 + barge-in spike. Keep the
browser-side primitives (they're good and on-device), but adopt Pipecat server-side for the pipeline
orchestration, interruption handling, and the maintained Anthropic + Smart-Turn integrations —
re-implementing those is the abstraction-without-payoff trap.

Confidence: framework capability claims **high**; "Pipecat is the right pick" is an **opinionated
medium** (LiveKit is genuinely close).

---

## 3. Streaming ASR

| Engine | Latency | Notes | Confidence |
|---|---|---|---|
| **Deepgram** (Nova/streaming) | ~150ms first-word, ~280–300ms final-turn | best price/latency, strong streaming partials | cresta.com/deepgram, **high** |
| **AssemblyAI** Universal-Streaming | 300–600ms | strong accuracy | assemblyai.com, **high** |
| **Gladia** | real-time tier, ~300ms class | EU-friendly, code-switching | **medium** |
| **faster-whisper / whisper-streaming** | tunable; self-host; partials are weaker | $0 marginal, GPU needed; best as fallback | **medium** |

Industry consensus for tuned real-time ASR is **200–500ms** (cresta.com, **high**). For the reference
stack pick **Deepgram** for its first-word latency and partials; partials matter because they let you
pre-warm Claude. Browser feasibility: send mic audio to the ASR over the WebRTC/WS transport
server-side; in-browser whisper is possible but not worth it when latency is the goal.

**Pick: Deepgram** (reference), **faster-whisper** self-hosted (fallback to kill per-minute ASR cost).

---

## 4. Low-latency TTS (and which expose viseme/timing for lip-sync)

Time-to-first-audio (Coval benchmark, May 2026, **high**):
- **Cartesia Sonic-3: P50 188ms** (Sonic Turbo model-only dips ~40ms)
- **ElevenLabs Turbo v2.5: 264ms** (Flash end-to-end TTFA ~150ms)
- **Deepgram Aura-2: 313ms**
- **Gradium: 155ms**

All are inside the **100–500ms** TTS TTFA band (cresta.com, **high**).

**Lip-sync data exposure — important nuance:** the claim that *Cartesia Sonic exposes no timing data*
was **refuted** (0-3), so do **not** assume you must do external extraction with Sonic — check its
current word/phoneme-timestamp surface. The one TTS with *fully documented, time-aligned* viseme
output is **Azure Neural TTS**: it emits a `VisemeReceived` event carrying a **viseme ID (0–21)** and
an **`Audio offset` timestamp in 100ns ticks** marking each viseme's start (learn.microsoft.com,
**high**), with 22 visemes mapping IPA phoneme sets (no 1:1 phoneme→viseme; e.g. `s`/`z` share viseme
15) (learn.microsoft.com, **high**). That makes Azure the *safe* choice if you want server-provided
visemes — at the cost of latency/naturalness vs Cartesia.

**Pick:** **Cartesia Sonic** for the reference stack (best TTFA + voice cloning for Monet's character
voice), driving lip-sync from **audio-frequency analysis in the browser** (§7) rather than depending
on TTS-side visemes. **Fallback/alt: Deepgram Aura-2** (keeps ASR+TTS on one vendor) or **Azure
Neural TTS** if you decide you want vendor-provided viseme IDs.

---

## 5. Speaker identity / enrollment ("recognize me, ignore others")

**Recommendation: Picovoice Eagle, in-browser.** Eagle runs on-device in the browser via **WASM/JS
across Chrome/Chromium, Edge, Firefox, Safari** (picovoice.ai, **high**) — so speaker ID never leaves
the device. It uses a two-stage **enroll-once / recognize-me** design: an enrollment step learns a
speaker's voiceprint, then a recognition step compares incoming frames against stored voiceprints in
real time (picovoice.ai, **high**) — recognition, not transcription. Picovoice publishes an open
benchmark comparing Eagle against **pyannote** and **SpeechBrain** (EER on VoxConverse)
(picovoice.ai, **high**) — vendor-published, so trust the *existence* of the comparison more than the
margins.

Browser caveat: Eagle's multithreaded path needs `SharedArrayBuffer` → requires **COOP/COEP
cross-origin-isolation headers**; without them it falls back to single-threaded (still works, slower)
(picovoice.ai, **high**). Set those headers on monet.sprited.ai.

Alternatives (**SpeechBrain ECAPA-TDNN, Resemblyzer, pyannote**) are open-source and accurate but are
Python/server-side by default — they break the on-device, in-browser property. Use them only if you
move speaker-ID server-side.

**Recognition vs true target-speaker extraction — when you need which:** Eagle answers *"is this my
enrolled user?"* (gating/routing). It does **not** *remove* an overlapping interferer from the audio
fed to ASR. For "ignore others" in a noisy/multi-talker room you want **target-speaker extraction**:
**VoiceFilter-Lite** is the on-device proof point — **2.2 MB** after 8-bit TFLite quantization, 3 LSTM
layers at 256 nodes, streaming by design (1D frequency-only convs, uni-directional LSTM, streaming
inputs) (arxiv.org, **high**), and "always harmless and sometimes helpful": ~no WER degradation on
clean/non-speech noise, **27.7% (rel. 49.0%) WER improvement under overlapping-speaker speech noise**
at β=0.8 (arxiv.org, **high**).

**Practical 2026 call:** ship **Eagle for recognition/gating** first (it's the in-browser,
enroll-once primitive you actually have a path to). Treat target-speaker *extraction*
(VoiceFilter-Lite-style, or Krisp/SpeakerBeam SDKs) as a **phase-2** add only if real users hit
multi-talker rooms — it's a model you'd have to port/run (TFLite/WASM), not a drop-in browser library
today. Confidence: Eagle feasibility **high**; "extraction is phase-2, not now" is an **opinionated
medium**.

---

## 6. Wake word + turn detection

- **VAD (browser, on-device):** `ricky0123/vad` runs **Silero VAD** in-browser via **ONNX Runtime Web
  (WASM)** in an AudioWorklet, returning per-frame speech probability (github.com, **high**). This
  validates on-device VAD feasibility and can replace/augment your hand-built VAD. Keep it
  browser-side for instant barge-in cutoff.
- **Semantic end-of-turn (the quality lever):** raw VAD over-triggers on mid-sentence pauses. Use a
  semantic turn model:
  - **Pipecat Smart Turn v2** — local `LocalSmartTurnAnalyzerV2`, 12ms/L40S but 410–6,272ms CPU
    (daily.co, **high**). GPU server → great; CPU → too slow, use hosted Fal variant.
  - **LiveKit TurnDetector** — audio-based, encodes intonation/pitch/rhythm, no transcript needed;
    **v1-mini runs locally on CPU <500MB RAM** (docs.livekit.io, **high**/**medium**).
- **Wake word (Porcupine / openWakeWord):** optional for Monet. A living-agent white-room chat that's
  already "listening" doesn't need a wake word for the main loop; reserve Porcupine-class wake-word
  only if you add a hands-free "summon Monet" gesture. (Picovoice Porcupine is the same vendor as
  Eagle → one SDK.) Note: openWakeWord *can* run 100% in-browser via community WASM wrappers
  (`openwakeword-wasm-browser`), despite the upstream repo only documenting a Python-backend path.

**Pick:** browser Silero VAD (instant barge-in) **+** a semantic turn detector server-side (Smart
Turn v2 on GPU, or LiveKit v1-mini on CPU). This two-tier setup is what closes most of the "it cut me
off" / "it waited too long" gap.

---

## 7. Lip sync: driving the chibi mouth in real time

Three approaches, decreasing coupling to the TTS vendor:

1. **TTS-provided visemes (Azure)** — most accurate, time-aligned `VisemeReceived` IDs 0–21 with
   100ns-tick offsets (learn.microsoft.com, **high**). Best fidelity, but locks lip-sync to Azure TTS
   and adds the offset-scheduling logic.
2. **Audio-frequency-driven visemes (recommended)** — **`lipsync-engine`** does real-time viseme
   detection from streaming audio in the browser via **AudioWorklet + Web Audio FFT**, mapping
   frequency-band energies → viseme shapes (not raw amplitude, not TTS phonemes) (github.com,
   **high**). It's **zero-dependency, ~15KB minified** (github.com, **medium** — size unverifiable,
   npm-unpublished, 48 stars, created 2026-02, **low maturity**), and maps energy to **15 Oculus/MPEG-4
   compatible visemes (or 6 simplified)**, emitting per-frame **open/width/round 0..1** params to
   drive any renderer (github.com, **high**). This is TTS-agnostic — works identically whether you use
   Cartesia, Deepgram, or Azure — which is why it pairs with the Cartesia pick.
3. **Phoneme/viseme extraction (Oculus LipSync / Rhubarb)** — heavier, offline-leaning; overkill for a
   streaming browser loop.

**Pick:** drive the mouth from **audio-frequency analysis in the browser** (option 2 pattern). It
decouples lip-sync from the TTS vendor, runs on-device with the audio you're already playing back, and
adds negligible latency. Given `lipsync-engine`'s low maturity, treat it as the *reference design* —
vendor it / fork it / reimplement the FFT-band→viseme mapping rather than depending on an unpublished
package. If you later want higher fidelity for close-ups, add Azure visemes as an optional path.

---

## 8. Recommended reference stack + cheaper fallback

### RECOMMENDED REFERENCE STACK
- **Transport / orchestration:** Pipecat (server) + WebRTC; browser-side keep your AEC3 + barge-in spike.
- **Brain:** Claude via Pipecat `AnthropicLLMService` (streaming, function calling, prompt caching) —
  fast tier for the live loop, async deliberation if needed (docs.pipecat.ai, **high**).
- **ASR:** Deepgram streaming (~150ms first-word, partials to pre-warm Claude) (cresta.com, **high**).
- **VAD:** browser Silero via `ricky0123/vad` (instant barge-in) (github.com, **high**).
- **Turn detection:** Smart Turn v2 on a GPU server (12ms) (daily.co, **high**).
- **TTS:** Cartesia Sonic-3 (P50 TTFA 188ms, voice clone for Monet) (coval, **high**); start TTS on
  first clause of Claude's stream.
- **Speaker ID:** Picovoice Eagle in-browser (enroll-once, COOP/COEP headers set) (picovoice.ai, **high**).
- **Lip-sync:** browser AudioWorklet FFT-band → viseme (lipsync-engine pattern, vendored) (github.com, **high**).

**Rough monthly cost @ small scale** (~1,000 conversations/mo, ~3 min each ≈ 3,000 voice-minutes):
Deepgram ASR ≈ $0.004–0.007/min → ~$15–25; Cartesia TTS ≈ usage-tier, ~$25–60 at this volume; Claude
tokens (short turns, fast tier, prompt-cached) ~$20–50; Pipecat self-hosted on a small GPU box for
Smart Turn ~$100–300 (or skip GPU and use Fal-hosted turn / LiveKit v1-mini CPU to drop to ~$30);
Eagle + browser libs $0 marginal. **Ballpark ~$160–435/mo**, dominated by the GPU. Drop the GPU
(CPU/hosted turn) → **~$80–185/mo**.

**Biggest risks:** (1) **Speaker-ID false-accepts/rejects in noise** — Eagle recognizes, it doesn't
*extract*; multi-talker rooms may need phase-2 VoiceFilter-Lite-style extraction. (2)
**Turn-detection on CPU** is 410ms–6,272ms (daily.co, **high**) — keep it on GPU or use a CPU-class
model (LiveKit v1-mini). (3) **lipsync-engine maturity** (npm-unpublished, 48 stars) — vendor, don't
depend. (4) **Claude TTFT variance** is the live-loop bottleneck — measure p95, not p50.

### CHEAPER FALLBACK
- **ASR:** self-hosted **faster-whisper** ($0 marginal, GPU/CPU you already run).
- **TTS:** **Deepgram Aura-2** (313ms TTFA, consolidate vendor) (coval, **high**) — or keep Cartesia if
  voice identity matters.
- **Turn detection:** **LiveKit v1-mini on CPU (<500MB RAM, free)** (docs.livekit.io, **medium**) — no GPU.
- **Everything else identical** (Pipecat + Claude, browser Silero VAD, Eagle, browser FFT lip-sync).
- **Cost:** ASR→$0, no GPU line item → **~$50–120/mo**, dominated by Claude tokens + Deepgram TTS.
  Trade-off: faster-whisper partials are weaker (slightly worse pre-warming) and CPU turn detection is
  slower than GPU Smart-Turn.

---

## Caveats & time-sensitivity

- **Fast-moving numbers (2025-2026):** TTS TTFA, ASR latency, and Claude TTFT all shift with new model
  releases — re-benchmark before committing (the Coval figures are May 2026). The cascade-vs-S2S *gap*
  is narrowing, not widening.
- **Vendor-published benchmarks** (Picovoice's Eagle vs pyannote/SpeechBrain; Daily's Smart Turn) are
  self-favoring — trust direction, re-verify margins.
- **`lipsync-engine` and Smart Turn v3** are very new / fast-changing; pin versions deliberately.
- Three claims were **refuted** and excluded: the "cascade >2s floor," "Sonic <90ms," and "Sonic
  exposes no timing data" — don't design around them.

## Open questions

1. What's Claude's *measured* p95 TTFT on the fast tier + region for short voice turns — does it
   actually fit the sub-1s budget under load?
2. Does Cartesia Sonic's current API expose word/phoneme timestamps (refuting the old "no timing
   data" claim) — if so, can we skip the FFT lip-sync entirely?
3. Will real Monet users be in multi-talker rooms (deciding whether phase-2 target-speaker
   *extraction* is needed, vs Eagle recognition alone)?
4. GPU or no-GPU for turn detection — does LiveKit v1-mini on CPU close the quality gap with Smart
   Turn v2 enough to drop the GPU line item entirely?

---

## Monet-specific notes (not from the research — orchestrator's reading)

- **Chrome already solves the noise layer for free.** Jin's live test: Chrome `getUserMedia` defaults
  (`echoCancellation`/`noiseSuppression`/`autoGainControl` = true, libwebrtc AEC3 + NS) strip
  non-speech noise so well it feels "perfect." On Apple hardware, mic-array beamforming + macOS Voice
  Isolation add another free layer. ⇒ **Do not build software noise suppression.** What the device
  does NOT do: tell *Jin's voice* from *another person's voice*. That's the only gap left, and it's
  exactly Eagle's job (recognition), not noise suppression's.
- **The two-layer framing.** Layer 0 = ChatGPT-grade full-duplex cascade (this report). Layer 1 = the
  moat: "Monet recognizes *you*" via Eagle. Layer 2 (Monet-only) = TTS→viseme drives the rendered
  mouth — couples this pipeline to the existing mouth-erase + WebCodecs compositing.
- **Wake word likely unnecessary** for an always-listening white-room agent; Eagle gating ("is this
  my user?") replaces the wake-word role with something warmer (recognition, not a trigger phrase).
