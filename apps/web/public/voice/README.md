# /voice — voice experience lab

A live, build-free space (not just a test) for designing Monet's voice interaction,
served by the app at **`/voice/`** — dev (`localhost:1874/voice/`) and prod
(`monet.sprited.ai/voice/`), testable on any device incl. phone, no separate server.
Built incrementally (hello-world → up). Research behind it:
[`experiments/voice-always-listening/`](../../../experiments/voice-always-listening/)
(RESEARCH.md, ECHO-CANCELLATION.md, OOV-VOCABULARY.md).

> Static page under `ui/public/voice/` — bypasses the React app/router. Shares the
> whiteroom's memory (same `monet.uid`) and brain/voice (`/api/chat`, `/api/tts`).

> **Shipped:** this lab's loop ("Approach A") is now LIVE in the whiteroom (the product) —
> `src/voice.ts` `createHandsFree()` + `Whiteroom.tsx`. The lab stays as the tuning surface.

## What it does now — Approach A (`index.html`)

Tap the orb → **hands-free conversation**:
- **Ears:** **Silero VAD** (`ricky0123/vad-web`, ONNX via `onnxruntime-web`/WASM, in-browser) detects each utterance; an **energy gate** (RMS) drops misfires.
- **STT:** the utterance audio → **Groq Whisper** (`whisper-large-v3-turbo`, `/api/whisper`) → KO+EN in one model, OOV (Sprited/Monet/제인) biased by the server `prompt`. ~$0.04/hr.
- **Brain / Voice:** transcript → `/api/chat` (Claude) → `/api/tts` (ElevenLabs).
- **Orb:** WebGL shader, audio-reactive, colour by phase. **Timeline:** color-coded gate viz (energy height · stage colour · ✓sent/✗gated marks).
- **Echo:** half-duplex — VAD gated off while she speaks, resumes after a cooldown.

## Known limits / next experiments

- **Background TALKER (TV/Netflix) is NOT rejected** — Silero is a raw VAD (any voice triggers). Verified: Whisper ignores a *quieter simultaneous* TV, but a TV-alone clip during your silence gets transcribed (a phantom). Mitigation today: **macOS Voice Isolation** (system, free).
- **Approach B** (`b.html`) — vanilla **Web Speech API** as a first-pass *gate*: it rejects background speakers well (Jin-verified on Netflix) but exposes **no audio** (so a parallel `getUserMedia` is still needed for Whisper) and **conflicts with our mic capture** (Web Speech grabs the mic → our capture goes silent). Parked with mic-mute diagnostics until that coexistence bug is solved.
- **Speaker-ID (Eagle, in-browser)** = the eventual moat — recognise only Jin's voice, ignore all others. **Whisper hallucination:** given a `prompt`, it confidently echoes the vocab on silence (`no_speech_prob≈0`) — handled by never sending silence (VAD) + a worker all-vocab backstop.
- **Barge-in** (talk over her) needs browser AEC3 fed the TTS reference — see ECHO-CANCELLATION.md.
