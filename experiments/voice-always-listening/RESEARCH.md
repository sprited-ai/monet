# Always-listening voice for Monet — research & recommendation

_Mid-2026. Context: Monet is a React browser app on Cloudflare Workers/Pages, Hono backend. She thinks with Claude (Anthropic) and speaks with ElevenLabs TTS in the browser. Today: push-to-talk via the Web Speech API. Goal: ChatGPT-style always-listening, hands-free turn-taking. She has a VOICE, so acoustic echo / self-capture is a first-class concern. Korean-primary, English-secondary. Indie budget, privacy-sensitive._

---

## 1. TL;DR recommendation

**Build the loop yourself, in the browser, keeping Claude + ElevenLabs.** Use [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) (Silero VAD, runs 100% client-side, free) to detect speech, and solve echo with **half-duplex gating** (pause the VAD while she speaks + a ~1.5s cooldown) as v1. For end-of-turn quality, layer Cloudflare's natively-hosted [`@cf/pipecat-ai/smart-turn-v2`](https://developers.cloudflare.com/ai/models/@cf/pipecat-ai/smart-turn-v2/) (the one full-loop component that genuinely runs on Cloudflare, $0.00034/audio-min, Korean-supported) so you can shorten the silence wait. This preserves Monet's brain and voice, fits the Workers/Pages model, and is the cheapest credible path. Do **not** reach for OpenAI Realtime or an OSS agent framework (LiveKit/Pipecat/TEN) — the first replaces Monet's persona and voice, the second forces a long-running container you don't want to operate.

- **Cheap path:** browser VAD (`@ricky0123/vad-web`, free) + half-duplex gating (free) + your existing Claude + ElevenLabs + your existing STT. Marginal new cost ≈ $0 plus your STT (see §4). Sub-cent if you add smart-turn-v2.
- **Best-quality path:** the above, plus a streaming cloud STT with built-in turn detection — **Deepgram Flux** (~$0.39–0.47/hr, native end-of-turn <400ms, Korean tuned in 2026) — and the **WebRTC-loopback AEC trick** for true full-duplex barge-in. Optionally adopt Cloudflare's own native [`@cloudflare/realtime-agents`](https://www.npmjs.com/package/@cloudflare/realtime-agents) runtime if you'd rather not hand-orchestrate the loop (see §5; still experimental).

---

## 2. The echo problem (the thing that will actually bite you)

Monet speaks aloud. With the mic always on, **the mic hears her own ElevenLabs voice**, the STT transcribes it, Claude treats its own words as a new user turn, and she replies to herself — a self-trigger feedback loop that doesn't just annoy, it corrupts the input pipeline ([coval.ai](https://www.coval.ai/blog/voice-ai-echo-cancellation), [livekit](https://livekit.com/blog/real-time-voice-agents-vs-model-apis)).

**The trap most people fall into:** "just set `echoCancellation: true`." The browser's built-in AEC (`getUserMedia({audio:{echoCancellation:true}})`) is real, widely available since Jan 2020 across Chrome/Safari/Firefox/Edge, and cancels the speaker output from the mic — **but only for audio the browser routes through a path it controls** (an `<audio>`/`MediaElement` or a WebRTC track). The standard low-latency ElevenLabs pattern — decode streamed PCM chunks and schedule them through Web Audio `AudioContext` buffers — is **invisible to the browser AEC**. It can't cancel what it can't see, so the mic hears her and the VAD self-triggers despite the flag being on ([gonogo.team](https://gonogo.team/blog/voice-ai-sub-500ms-latency-echo-cancellation), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/echoCancellation)). Azure's own docs confirm an SDK can still catch the bot's own voice during TTS even with AEC on ([learn.microsoft.com](https://learn.microsoft.com/en-us/answers/questions/5522072/azure-speech-sdk-continuous-recognition-not-always)).

**Three mitigation tiers, and what's realistic for v1:**

1. **Half-duplex gating (RECOMMENDED for v1).** While she speaks, `vad.pause()`; when ElevenLabs playback ends, wait a **~1–1.5s cooldown** (room/speaker resonance keeps mic RMS elevated at ~0.025–0.04 vs a ~0.01–0.02 baseline for 1–2s after audio stops), then `vad.start()`. Simple, robust, free, ~10 lines of state. Teams report self-disconnect/loop errors "essentially disappeared" with this ([gonogo.team](https://gonogo.team/blog/voice-ai-sub-500ms-latency-echo-cancellation)). **Cost:** she can't be interrupted mid-sentence. For a cozy 1:1 companion that is acceptable, and it's the right v1.

2. **Make browser AEC actually work (cheap upgrade).** Route ElevenLabs playback through an `<audio>` element (or the **WebRTC loopback trick**: pipe TTS through a local `RTCPeerConnection` pair with `addTrack` so the browser treats it as a remote participant and feeds it to AEC as the reference signal). Now the built-in AEC3 canceller sees the reference and subtracts it, enabling **full-duplex barge-in** — keep the VAD active during playback and `stop()` the TTS node the instant `onSpeechStart` fires ([cv.nguyenbinh.dev/browser-aec](https://cv.nguyenbinh.dev/browser-aec/), [switchboard.audio](https://switchboard.audio/hub/how-webrtc-aec3-works/)). Caveats: AEC needs a few seconds to converge (weakest right at conversation start), Safari/WebKit has historical `echoCancellation` quirks, and residual echo can leak during double-talk — so keep a VAD/energy gate on top.

3. **Provider/server-side AEC (overkill).** OpenAI Realtime or LiveKit handle echo as part of their WebRTC stack. Only relevant if you adopt one of those whole architectures (you shouldn't — §3).

**v1 verdict:** half-duplex gating with a tuned cooldown. Ship barge-in (tier 2) as a fast-follow only if interrupt-while-she-talks turns out to matter for the feel.

---

## 3. Approaches compared

| Approach | Runs in browser? | Cost (always-on est.) | Korean | Turn-taking / barge-in | Integration effort | Verdict for Monet |
|---|---|---|---|---|---|---|
| **Browser VAD (`@ricky0123/vad-web`) + half-duplex + your STT + Claude + ElevenLabs** | VAD yes (Silero/ONNX in-browser); STT via Worker relay | ~$0 + your STT (§4) | VAD language-agnostic; Korean = your STT's job | You build it; barge-in optional via AEC trick | Low–medium | **RECOMMENDED.** Keeps her brain + voice, fits Workers, cheapest |
| **+ Cloudflare `smart-turn-v2` for semantic end-of-turn** | HTTP/WebSocket call from your Hono Worker | +$0.00034/audio-min (negligible) | Korean explicitly supported (1 of 14) | Better end-of-turn → shorter silence wait | Low add-on | **RECOMMENDED add-on.** Only full-loop turn model native to Cloudflare |
| **Deepgram Flux (streaming STT w/ built-in turn detection)** | Worker relay (key server-side) | ~$0.39–0.47/hr streamed | Strong; 2026 Korean tuning + word-spacing fix | Native end-of-turn <400ms; barge-in still on you | Medium | **Best-quality STT pairing.** Cleanest turn-taking without OpenAI |
| **OpenAI Realtime (gpt-realtime / -mini)** | Yes, WebRTC; Worker mints ephemeral key | ~$3.50–6/hr (full), more w/ big prompt | Excellent | Provider solves all of it | Low | **NO.** Replaces Claude AND ElevenLabs — kills Monet's persona/voice. Also 10–60× the cost |
| **LiveKit Agents (OSS + Cloud)** | JS client yes; agent = long-running container | Framework free + ~$0.01/min Cloud or VM | Turn-detector supports Korean (1 of 14) | Best-in-class, out of the box | High (container + ops) | **NO for v1.** Keeps Claude/ElevenLabs as plugins but forces infra a 1-person team shouldn't run |
| **Pipecat (OSS, Daily)** | JS client yes; pipeline = Python server | Framework free + host + your providers | Smart Turn supports Korean | Good; you deploy it | High (Python server) | **NO.** Python-centric, "hardest to deploy," mismatch with JS Worker stack |
| **Cloudflare native voice pipeline (`@cloudflare/realtime-agents` / Agents SDK `withVoice`)** | React hook for mic/playback; loop runs on Cloudflare (Durable Object + Workers AI) | Workers AI usage + your providers | Depends on chosen STT/TTS — verify Korean | Built-in turn detection + interruption/barge-in | Medium | **WATCH.** Genuinely fits the stack and can keep ElevenLabs; still **experimental**. Strong fast-follow candidate |
| **Ultravox (hosted speech-to-speech)** | Hosted; thin Worker for auth | ~$0.05/min (~$3/hr) | Present; verify quality | Provider handles it | Low (hosted) | **NO.** Hosted path replaces Claude + ElevenLabs voice |
| **TEN Framework / TEN VAD** | TEN VAD WASM yes; framework = server | Free + self-host | VAD language-agnostic | Strong full-duplex; complex | High | **Overkill.** TEN VAD WASM is a usable Silero alternative, but skip the framework |
| **Vocode** | Python server | Free + host | Plugin-dependent | Less polished | Medium | **NO.** Development stalled (last commit 2024-11), seeking maintainers — risky for a greenfield build |
| **Web Speech API continuous (today's API, extended)** | Yes, but Chrome→Google / Safari→Apple cloud | Free | ko-KR OK, no tuning control | None reliable; no echo handling | Low | **NO for always-on.** Continuous mode is broken (see §6); fine only as a push-to-talk fallback |

> **Stale-info flag (corrected):** an earlier survey claim said "NO full-loop framework runs on Cloudflare; a Worker can ONLY mint tokens and serve the app." That is **outdated.** As of mid-2026 Cloudflare ships its own server-side voice-agent runtime — [`@cloudflare/realtime-agents`](https://www.npmjs.com/package/@cloudflare/realtime-agents) and the Agents SDK [`withVoice` pipeline](https://developers.cloudflare.com/agents/guides/build-a-voice-agent/) — that runs the full STT + turn-detection + LLM + TTS + interruption loop inside a Durable Object on Cloudflare's network, with a matching React hook ([blog.cloudflare.com/voice-agents](https://blog.cloudflare.com/voice-agents/), [realtime voice AI](https://blog.cloudflare.com/cloudflare-realtime-voice-ai/)). It's experimental and you must verify Korean on its built-in providers, and it doesn't solve client-side echo for you — but the "Workers can only mint tokens" framing no longer holds. Workers' CPU limit is also now up to 5 min/request, loosening old assumptions.

---

## 4. Pricing (2026, concrete) + $/hour-of-conversation

The biggest cost lever is the **billing unit**: cloud STT bills on streamed-audio (or open-session) duration, so an open mic costs money every minute it's connected — **gate the stream with VAD so you only stream when the user is actually speaking, and never transcribe her own TTS.** That alone cuts STT cost 2–4×.

| Option | Unit price | ~$/hr open mic | Korean | Notes |
|---|---|---|---|---|
| **Web Speech API** | Free | **$0** | ko-KR OK | Audio goes to Google/Apple (privacy), continuous unreliable |
| **On-device WASM (Moonshine / whisper.cpp / Vosk)** | Free | **$0** | weak–mediocre | Private, no backend; Korean quality below cloud; client CPU/battery + model download |
| **Cloudflare `@cf/pipecat-ai/smart-turn-v2`** | $0.00034/audio-min | ~$0.02/hr | Korean (1 of 14) | Turn detection only, not STT. Native to your Worker |
| **Deepgram Nova-3 (streaming)** | $0.0048/min mono, $0.0058 multi | **~$0.29–0.35/hr** | Strong; 2026 Korean tuning | $200 free credit, no expiry (~430 hrs). Cheapest credible cloud STT |
| **Deepgram Flux** | $0.0065/min EN, $0.0078 multi | **~$0.39–0.47/hr** | Strong; KO/EN mid-call switch | Built-in end-of-turn <400ms — solves turn-taking |
| **ElevenLabs Scribe v2 Realtime** | ~$0.0065/min | **~$0.39/hr** (some tiers ~$0.28) | Korean "medium" WER tier | ~150ms latency; **same vendor as your TTS** — one bill, one mental model |
| **AssemblyAI Universal (streaming)** | $0.0025/min | **~$0.15/hr** | Korean less proven | Billed on **session** duration — close sockets aggressively. +10% from Jul 1 2026 |
| **OpenAI gpt-4o-mini-transcribe** | $0.003/min | **~$0.18/hr** | Good | Cheap; Whisper-family hallucinates on silence/echo — risky for always-on |
| **OpenAI gpt-4o-transcribe** | $0.006/min | **~$0.36/hr** | Good | Streaming mode; more robust than whisper-1 |
| **OpenAI realtime-whisper (live streaming)** | $0.017/min | **~$1.02/hr** | Good | The expensive streaming-transcription tier |
| **Google STT v2 (Chirp, streaming)** | ~$0.016/min | **~$0.96/hr** | Solid | 15s rounding punishes short turns; not Workers-native |
| **Azure Speech (real-time)** | $0.0167/min | **~$1.00/hr** | Good | Most expensive mainstream; documented self-capture issues |
| **OpenAI Realtime (full speech-to-speech)** | $32/$64 per 1M audio in/out tok | **~$3.50–6/hr** | Excellent | Replaces Claude + ElevenLabs. Big system prompt inflates this sharply |

> **Pricing-claim flag (corrected):** an earlier "~$1.63/min for a 1000-word-prompt gpt-realtime" figure was **mis-attributed** — those per-minute numbers were computed for the older, cheaper-audio `gpt-4o-realtime` ($10/$20 per 1M), not for `gpt-realtime` at $32/$64. At the real $32/$64 rate the per-minute cost is **higher** than $1.63/min. The qualitative point stands: re-sending a rich persona prompt every turn dramatically inflates cost. By mid-2026 the flagship is `gpt-realtime-2` (same $32/$64). Either way, OpenAI Realtime is the wrong shape for Monet.

**Recommended STT for Monet:** **Deepgram** (Nova-3 for cheapest, **Flux** if you want turn detection bundled) — Korean is explicitly tuned and it decouples cleanly from Claude + ElevenLabs. **ElevenLabs Scribe v2 Realtime** is the convenience pick (one vendor) if its Korean "medium" tier tests well enough on your content. With VAD gating + half-duplex (don't transcribe her voice), real-world spend lands well under the table's open-mic figures.

---

## 5. OSS that solves it end-to-end

- **LiveKit Agents** ([github](https://github.com/livekit/agents)) — the best-engineered OSS full loop: Silero VAD + a 135M semantic turn-detector (Korean among 14 langs, AUC ~0.96, ~39% fewer false interruptions), barge-in out of the box, and you can plug in Anthropic + ElevenLabs. **But** the agent is a long-running container (~4 cores/8GB per server) — not Workers-native. **Overkill for a 1-person indie team** unless you're ready to run/scale agent infra or pay LiveKit Cloud ($0.01/min).
- **Pipecat** ([github](https://github.com/pipecat-ai/pipecat)) — richest integration ecosystem, BYO Claude + ElevenLabs, ships the open **Smart Turn** model. **But** Python server, reputationally fiddly to deploy, mismatched with a JS/TS Worker codebase.
- **TEN** — highest-performance C-core, full-duplex; **TEN VAD's WASM build** is a genuinely good client-side Silero alternative (TEN's own benchmarks claim it beats WebRTC/Silero VAD — validate on your own KO/EN audio). The full framework is overkill.
- **Vocode** — **avoid**; development stalled (last commit 2024-11-15, no releases since 2024, README seeking maintainers).
- **Cloudflare's own** [`@cloudflare/realtime-agents`](https://www.npmjs.com/package/@cloudflare/realtime-agents) / Agents SDK [`withVoice`](https://developers.cloudflare.com/agents/guides/build-a-voice-agent/) — **the only "framework" that fits a Cloudflare + browser stack** without a separate container: the full loop runs in a Durable Object using Workers AI bindings, with a React hook for mic/playback/interrupt. Caveats: experimental; verify Korean on its built-in STT/TTS (Deepgram/ElevenLabs/Workers AI Flux are pluggable); client-side echo is still yours to solve. **Best framework candidate for Monet — as a fast-follow, not v1.**

**Bottom line:** for v1, don't adopt a framework. Assemble browser VAD + your STT + Claude + ElevenLabs yourself; the loop is a small state machine. Keep Cloudflare's native voice pipeline on the radar for when you want managed turn-taking/interruption without leaving the stack.

---

## 6. Failure modes & mitigations

- **Self-capture / echo loop (she hears herself).** → Half-duplex gating (`vad.pause()` during TTS + ~1.5s cooldown with raised threshold). For barge-in, route TTS through `<audio>`/WebRTC-loopback so browser AEC sees the reference signal. Don't rely on `echoCancellation:true` alone for Web-Audio-scheduled PCM.
- **Web Speech API continuous mode is unreliable.** Chrome auto-stops after ~3–4s silence and again at ~60s; iOS continuous is effectively broken (ever-growing single string); `onend` drops force a racey restart loop with audible beeps on Android ([webreflection](https://webreflection.medium.com/taming-the-web-speech-api-ef64f5a245e1), [addpipe](https://blog.addpipe.com/a-deep-dive-into-the-web-speech-api/)). → Don't use it for always-on; use `@ricky0123/vad-web` + a real STT. Keep Web Speech only as a push-to-talk fallback.
  - **Stale-info flag (refuted):** the survey's "supported in Chromium-Edge" is **wrong** — caniuse lists Edge as no-support; Edge exposed a non-functional no-op. Real Edge support landed only in **Canary/Dev 150+ behind a flag, via a new on-device model** (`processLocally=true`), not stable Edge ([caniuse](https://caniuse.com/speech-recognition), [MDN BCD #22126](https://github.com/mdn/browser-compat-data/issues/22126), [MS docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/speech-recognition-api)). Treat Web Speech as **Chrome + Safari only**, and cloud-based on both.
- **End-of-turn cuts the user off / waits awkwardly.** Pure silence-timeout has a hard latency/accuracy tradeoff — an ~800ms window "adds nearly a full second to every response" ([livekit](https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection)). → Use a semantic turn model (Cloudflare `smart-turn-v2`, or Deepgram Flux) to shorten the silence wait without truncating thinking pauses ("음…").
- **STT hallucinates on silence/echo** (Whisper-family especially). → Gate STT with VAD (only send buffered speech), never stream her TTS tail.
- **Cost runs away on an open mic.** → VAD-gate the stream; close sockets the instant a turn ends; prefer per-audio (Deepgram) over per-session (AssemblyAI) billing for bursty turns.
- **Mic permission denied / lost.** Cold prompts get permanently denied; grants now expire after ~90 days inactivity (Chrome/Edge 121+, Firefox 123+). → Ask **after** a user gesture with context (~2.5× grant rate), localize copy in Korean, show a prominent "listening now" indicator + one-tap mute, grant mic + `speechSynthesis` in the same trusted click ([web.dev](https://web.dev/articles/permissions-best-practices)).
- **iOS/Safari constraints.** `AudioContext` must be unlocked from a user gesture; PWA mic use is restricted; a video play/pause can break recognition. → Unlock audio on first tap; test the full loop on real iOS Safari early.
- **Bluetooth / external-speaker setups degrade AEC.** No API tells you headphones vs speakers. → Default to half-duplex (robust regardless); offer a manual "I'm on headphones" toggle to relax gating if you add barge-in.
- **Background noise / music false-triggers VAD.** → Tune `positiveSpeechThreshold`, `minSpeechFrames`, `redemptionMs`; re-tune for Silero v5 (512-sample frames) vs legacy.
- **First-load model download hurts the "5-second cozy" first impression.** → Self-host the VAD WASM + ONNX assets on Cloudflare (`baseAssetPath`/`onnxWASMBasePath`), prefetch, and don't block the first frame on it.

---

## 7. Recommended prototype/test plan for `experiments/`

Ordered, small experiments — validate before touching the whiteroom. Each lists **what to build** and **what to measure**.

1. **VAD-in-browser spike.** Wire `@ricky0123/vad-web` (Silero v5) into a bare React page; log `onSpeechStart`/`onSpeechEnd`. Self-host the WASM/ONNX assets. **Measure:** cold-load time, CPU on a mid laptop + a real iPhone, false-trigger rate on KO + EN speech and on silence/background noise. _Gate: does it fire cleanly on real Korean?_

2. **Echo / half-duplex harness (THE critical one).** Play a recorded ElevenLabs Monet clip through the laptop speaker while VAD runs. First with no gating (confirm the self-trigger loop happens), then with `vad.pause()` + cooldown. **Measure:** does it self-trigger ungated? what cooldown (try 0.8/1.2/1.5s) and threshold kills it without clipping the user's first word? Repeat on Bluetooth speaker + phone speaker. _This decides whether v1 ships at all._

3. **STT bake-off on Korean.** Same captured utterances → **Deepgram Nova-3/Flux**, **ElevenLabs Scribe v2**, and **OpenAI gpt-4o-transcribe**, relayed through a Hono Worker. **Measure:** Korean WER on Jin's own voice + a few testers, KO/EN code-switch handling, p50/p95 latency, $/hr at realistic gated duty cycle. _Pick the STT here._

4. **End-of-turn quality.** Add Cloudflare `@cf/pipecat-ai/smart-turn-v2` (and compare Deepgram Flux's built-in) on the buffered utterance. **Measure:** silence-wait you can cut to without truncating mid-thought pauses; false "you're done" rate on Korean; added latency (Worker round-trip vs Flux inline). _Target: 200–400ms turn gap._

5. **Full hands-free loop, half-duplex.** Stitch it: listen → VAD speech → (turn model says done) → STT → Claude → ElevenLabs → re-arm. **Measure:** end-to-end turn latency (user stops → she starts), error/restart rate over a 10-min conversation, false turns per minute. _Gate: does a 10-minute Korean chat feel natural without manual intervention?_

6. **Barge-in (fast-follow, only if it matters).** Route ElevenLabs through `<audio>` or the WebRTC-loopback; keep VAD live during playback; stop TTS on `onSpeechStart`. **Measure:** can you interrupt her mid-sentence without self-triggering? AEC convergence time at conversation start; residual-echo false-barge rate (target <2%); TTS flush <60ms.

7. **Cost & privacy validation at session length.** Run realistic 5–10 min sessions with the chosen STT + gating. **Measure:** actual $/conversation vs the §4 estimate, % of audio actually streamed (duty cycle), and write the privacy story: VAD/audio stays local until a turn ends, mic indicator + mute, Korean consent copy.

8. **(Optional) Cloudflare native voice pipeline spike.** Stand up `@cloudflare/realtime-agents` / Agents SDK `withVoice` with ElevenLabs TTS. **Measure:** Korean quality on its STT path, whether it preserves Monet's Claude persona + ElevenLabs voice, how its built-in interruption compares to your hand-rolled loop, and how experimental-rough it is. _Decides whether to migrate the managed loop later._

**Suggested order to ship:** 1 → 2 → 3 → 4 → 5 = the v1 always-listening half-duplex loop. 6 and 8 are deliberate fast-follows once the cozy loop feels right.
