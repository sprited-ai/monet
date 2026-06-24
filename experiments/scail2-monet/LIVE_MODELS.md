# Live character streaming — model landscape (the "SCAIL-2 but live / ARKit" question)

Research for Jin's ask: *models that drive a character **live**, streamed in real time* —
the real-time counterpart to SCAIL-2's offline clip factory. Surveyed June 2026.

> **⚠️ Governing principle (Jin, 2026-06-24): the goal is a *living agent*, not a live
> VTuber.** A VTuber is **exo-driven** — a human's face (ARKit) puppets a mask. A living
> agent is **endo-driven** — its body is driven by *its own internal state* (the
> inner-speech loop, `jin-intention-living-ai`). So ARKit-as-live-driver is the *wrong*
> input modality, even though it's technically real-time. The render tech below stays
> valid; **the driver must be Monet's own state, not a human capture.**
>
> Reframe the input:
> ```
> ❌ human face (ARKit) ──▶ Monet           (VTuber / puppet)
> ✅ Monet's loop ──▶ her body               (living being)
>    inner-speech → emotion/intent → speech → audio → lips/expression → body
> ```
> Same renderers (THA4 takes a 45-dim pose vector — generate it from her TTS visemes +
> affect, not from ARKit). The relevant live tech is therefore **audio/emotion
> self-driven** (Live Avatar / StreamAvatar / Audio2Face-class), not face-capture.
>
> Human capture (ARKit / E2) keeps **one** legit role: **authoring the offline library**
> (a human performs → SCAIL-2 → her clip vocabulary), which she later draws on *by her own
> volition*. That is authoring, not live puppeting.

Headline (with that caveat): **face/upper-body real-time rendering is solved today;
full-body live is still bleeding edge.** The open work is wiring the *driver* to her loop.

## The split that matters
- **Rig-based** (ARKit-native, mature, 60 fps, manual rig): Live2D, THA4.
- **Neural / diffusion** (flexible, fewer manual steps, newer): LivePortrait, PersonaLive.
- **Real-time streaming diffusion** (the "causal SCAIL-2" frontier): Self-Forcing, MirageLSD.
- **Face/upper-body = solved real-time. Full-body live = not productizable yet.**

## Tier A — real-time TODAY, anime-native, ARKit-driven (the practical answer)

| model | what | real-time | anime | ARKit | note |
|---|---|---|---|---|---|
| **THA4** ⭐ | single anime image + 45-dim pose → animated frame | <30 fps, 512², consumer GPU, distilled <2 MB | native | **yes — `ifacialmocap_puppeteer` takes iOS TrueDepth/ARKit blendshapes** | **Monet already has it** (`experiments/tha4/`, memory `monet-face-rigging-pipeline`). This *is* "ARKit → live anime character." |
| **Live2D + VTube Studio / Warudo + VBridger** | 2D mesh-deform rig | 60 fps | native (industry std) | yes — ARKit 52 blendshapes → Live2D params | rock-solid, but needs Monet rigged as a Live2D model (manual rigging) |
| **LivePortrait** | single portrait + driving video/webcam → animated, implicit keypoints | ~real-time on GPU | yes (anime/artistic) | webcam/video drive (ARKit-mappable) | production-grade (Kuaishou/Douyin), 17k★, face-focused |

THA4 is the spiritual match to "SCAIL-2 but live": drive *this character* from face motion,
real-time, no per-clip rig. Limited to face + upper body, but that's most of "feeling alive."

## Tier B — bleeding edge 2026: real-time streaming diffusion

| model | what | latency / fps | relevance |
|---|---|---|---|
| **PersonaLive!** (CVPR 2026, GVCLab) | diffusion portrait animation, **autoregressive micro-chunk streaming** | low-latency, 7–22× speedup vs prior | newest "expressive portrait for live streaming"; the diffusion path to live face |
| **MirageLSD** (Decart) | live-stream video-to-video diffusion | **<40 ms, 24 fps** | proves real-time diffusion is here; full-scene v2v, not character-specific |
| **Self-Forcing / CausVid / LongLive / StreamDiffusionV2** | autoregressive few-step (DMD) distillation of video diffusion | real-time-ish on top GPU | **the architecture that could make SCAIL-2 itself live** — distill SCAIL-2's motion transfer into a causal base. The R&D bet. |
| **Live Avatar / Kling-Avatar / StreamAvatar / RAIN** | streaming audio/pose-driven avatar, infinite length | 20–48 fps | audio-driven → good for *talking* Monet |

## Tier C — full-body live (the genuinely hard part)
**Animate-X, MusePose (Animate-Anyone variant), Kling-MotionControl** — pose-driven
*full-body* character animation, but **mostly not real-time yet**. SCAIL-2 offline stays
the tool for rich full-body. Full-body *live* = wait for causal diffusion to mature.

## Recommendation for Monet — endo-driven
The live face is reachable now, but driven by **her own state**, not ARKit:

```
Monet's loop (LLM + memory + affect) → speech text + emotion
   → TTS (her voice) → audio visemes + emotion → 45-dim pose vector
   → THA4 (or 2D rig) → live Monet face @ ~30fps        [no human in the loop]
```

Concrete layered runtime (extends the 3-tier from the latency study):
- **Live, self-driven (her audio/affect → THA4):** real-time lip-sync / expression / gaze
  from *her own* generated speech + emotion. The "alive" feel. *Monet already has THA4*
  (`experiments/tha4/`) — rewire its input from `ifacialmocap` (ARKit) to a state→pose source.
- **On-demand (SCAIL-2, ~8–28 s):** rich custom gestures generated when *she* needs one.
- **Pre-rendered library (SCAIL-2 offline):** staple idle/cozy/talk clips, 0 latency,
  authored partly from human performance (E2) but selected by *her* director FSM.
- **Future bet:** causal-diffusion **full-body** live = Self-Forcing/CausVid base + SCAIL-2
  motion-transfer distilled in, driven by her state. R&D project on a Blackwell.

For the live face driver specifically, the audio/emotion-driven line (**Live Avatar /
StreamAvatar / Audio2Face-class**, or THA4 fed a generated pose vector) is the right family
— it self-animates from *her* voice. **LivePortrait / PersonaLive / Live2D are
human-capture-shaped** (great renderers, but their native driver is an external face);
usable only if their input is rewired to her state. Avoid anything that *requires* a human
performer at runtime — that's the VTuber trap.

## Sources
THA4 [project](https://pkhungurn.github.io/talking-head-anime-4/) ·
[arXiv 2311.17409](https://arxiv.org/abs/2311.17409) · THA3 [repo](https://github.com/pkhungurn/talking-head-anime-3-demo) (iFacialMocap/ARKit puppeteer) ·
[LivePortrait](https://github.com/KwaiVGI/LivePortrait) ·
PersonaLive [repo](https://github.com/GVCLab/PersonaLive) / [arXiv 2512.11253](https://arxiv.org/abs/2512.11253) ·
[MirageLSD](https://decart.ai/publications/mirage) ·
[Self-Forcing](https://arxiv.org/abs/2502.08690)-class causal video diffusion ·
[StreamDiffusionV2](https://streamdiffusionv2.github.io/) ·
Live2D + ARKit via [VTube Studio / VBridger / Warudo](https://docs.warudo.app/docs/mocap/face-tracking).
