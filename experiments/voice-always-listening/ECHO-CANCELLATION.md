# Echo cancellation for Monet — options, what Zoom/Meet use, recommendation

_Deep-dive on [`RESEARCH.md`](./RESEARCH.md) §2. Question: Monet has a voice; with an always-on mic she hears herself. We KNOW the source (the TTS we're playing) — can we detect & filter the echo? Yes — that's **AEC (acoustic echo cancellation)**, and having the reference signal is exactly what makes it possible._

## TL;DR

**Start with the browser's built-in AEC — it's WebRTC AEC3, the same canceller Google Meet uses.** It's free, battle-tested, and already in Chrome/Safari/Edge via `getUserMedia({audio:{echoCancellation:true}})`. The only reason it doesn't work for us today: we play TTS through **Web Audio** (`AudioContext` buffers), which the browser AEC can't see as the reference ([Chromium #687574](https://bugs.chromium.org/p/chromium/issues/detail?id=687574)). **Fix = route Monet's voice through a path AEC3 sees** (an `<audio>` element, or a WebRTC loopback) so it uses her audio as the reference and subtracts her from the mic. Then keep the VAD live during playback → only YOUR voice triggers → barge-in works.

Only if AEC3 proves insufficient (residual echo, hard double-talk, Bluetooth) do we reach for a **model** — and good web-deployable ones exist (escalation ladder below). But browser-first is the right call.

## Why a plain "subtract the source" doesn't work (and what AEC actually does)

The mic doesn't capture the TTS samples — it captures them after **speaker → air → room reflections → mic**: delayed (20–200ms, varies, Bluetooth worse), attenuated, filtered by hardware response, reverberated. So you must subtract a *transformed* version, and estimate that transform in real time. AEC3 does exactly this ([switchboard.audio — how AEC3 works](https://switchboard.audio/hub/how-webrtc-aec3-works/)):
- **Delay estimation** — cross-correlates reference vs capture to align them.
- **Adaptive filter** (partitioned-block frequency-domain, PBFDAF) — removes 20–40 dB of linear echo.
- **Double-talk detection** — when you and she speak at once, it freezes filter adaptation so it doesn't try to cancel *you*.
- **Residual echo suppressor** — frequency-dependent gain on whatever leaks through.

This is why you don't hand-roll it — and why "we have the source" is necessary but not sufficient.

## What Zoom / Google Meet actually use

- **Google Meet = WebRTC AEC3, client-side.** Google authored WebRTC; Meet integrates AEC3 directly with Chrome ([Google Workspace — echo cancellation](https://workspace.google.com/resources/echo-cancellation/), [switchboard.audio](https://switchboard.audio/hub/how-webrtc-aec3-works/)). So "use the browser tech" literally *is* using Meet's echo canceller.
- **Zoom = proprietary DSP + ML stack** (not WebRTC for the native client; their web client leans on WASM). Custom AEC/noise tuned in-house — a bigger build than we'd ever want, and not exposed to us.
- **LiveKit / many voice-agent stacks** ship **Krisp** (neural, WASM) for noise + echo on top of WebRTC AEC ([LiveKit noise/echo docs](https://docs.livekit.io/transport/media/noise-cancellation/)).

Takeaway: the industry default in the browser is **WebRTC AEC3** (the built-in), with a neural layer (Krisp-class) added only when the built-in isn't enough.

## The escalation ladder (browser-first)

| Tier | What | Reference? | Cost / license | Browser fit | When |
|---|---|---|---|---|---|
| **0 — Browser AEC3** (RECOMMENDED start) | `echoCancellation:true` + route TTS via `<audio>` or WebRTC-loopback so AEC3 sees it | AEC3 auto-grabs it from the controlled output path | Free, built-in | Native, zero deps | Default. Same as Google Meet |
| **1 — SpeexDSP AEC (WASM)** | Classic adaptive AEC compiled to WASM; `speex_echo_cancellation(mic, speaker_ref, out)` | **You feed it directly** (our known TTS PCM) — no routing trick needed | Free (BSD); [xiph/speexdsp](https://github.com/xiph/speexdsp), [thewh1teagle/aec (Rust→wasm32)](https://github.com/thewh1teagle/aec) | AudioWorklet + WASM | If AEC3 routing is flaky and we want to feed the reference ourselves |
| **2 — Small neural AEC (ONNX/TFLite)** | [**DTLN-aec**](https://github.com/breizhn/DTLN-aec) (Microsoft AEC-Challenge model, 1.8–10.4M params, real-time on a Pi3B+, takes mic + loopback ref); [**EchoFree**](https://arxiv.org/html/2508.06271v1) (2025, 278K params, ~DeepVQE-S quality); GTCRN-class via [sherpa-onnx](https://github.com/Xiaobin-Rong/gtcrn) (ONNX web inference proven, but SE/NS not ref-AEC) | DTLN-aec/EchoFree take the reference explicitly | Free (research/MIT-ish — verify per repo) | onnxruntime-web (we already use it for VAD!) or TFLite-WASM | If we need to beat AEC3 on residual echo / dereverb. DTLN-aec is the most proven drop-in |
| **3 — Krisp Web SDK** | Commercial neural noise + echo + dereverb, WASM, 10ms frames, multi-rate | Handled internally | **Paid** ([krisp.ai SDK](https://sdk-docs.krisp.ai/)) | Drop-in JS/WASM SDK | If we want best-in-class without building, and budget allows |

Notes:
- **RNNoise / DeepFilterNet / Picovoice Koala / GTCRN** are **noise suppression** (no reference) — they clean background noise, they do **not** cancel her own voice. Don't confuse them with AEC. (Useful as a *second* stage on top of AEC if mic noise is a problem.)
- We already ship **onnxruntime-web** for the Silero VAD, so a small ONNX AEC (DTLN-aec/EchoFree) is a natural fit if Tier 0/1 fall short — same runtime, ~hundreds of K to a few M params.

## Recommendation for Monet

1. **v1 (no AEC):** half-duplex gating — pause VAD while she speaks + ~500ms cooldown (Jin-tested). No barge-in, but zero echo risk and dead simple.
2. **Barge-in v1 (browser-first):** keep VAD live during playback, route ElevenLabs TTS through an `<audio>` element (or WebRTC-loopback) so **AEC3 cancels her** → VAD fires only on you → `stopSpeak()` on speech start. This is the Google-Meet approach. Cost: lose Web Audio loudness-normalization (move it server-side or accept it).
3. **Escalate only on evidence:** if the spike shows AEC3 leaves too much residual (she still self-triggers, or double-talk is bad on Bluetooth), drop in **SpeexDSP-WASM** (feed our own reference) or **DTLN-aec** (ONNX, same runtime as VAD).

## Feeds into the spike

Extend the `vad-spike` with a **barge-in test mode**: play `monet-sample.mp3` via an `<audio>` element (AEC-visible) instead of Web Audio, keep VAD running during playback, and measure — does her voice still self-trigger (AEC insufficient → escalate to Tier 1/2), or is it clean enough that only real user speech fires (AEC3 is enough → ship browser-first barge-in)? That single test decides which tier we need.
