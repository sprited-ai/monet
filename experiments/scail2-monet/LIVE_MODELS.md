# Live character streaming — model landscape (the "SCAIL-2 but live / ARKit" question)

Research for Jin's ask: *models that drive a character **live** from input like ARKit,
streamed in real time* — the real-time counterpart to SCAIL-2's offline clip factory.
Surveyed June 2026. Headline: **face/upper-body is solved and real-time today; full-body
live is still bleeding edge.** And Monet already owns the strongest practical piece (THA4).

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

## Recommendation for Monet
The dream is reachable **now for face + upper-body**, reusing what we have:

```
iPhone (ARKit / TrueDepth) ─ 52 blendshapes ─▶ THA4 ─▶ live Monet face @ ~30fps
```

Concrete layered runtime (extends the 3-tier from the latency study):
- **Live (ARKit → THA4):** real-time face / expression / lip-sync / gaze. The "alive" feel. *Monet already has THA4.*
- **On-demand (SCAIL-2, ~8–28 s):** rich custom gestures generated when asked.
- **Pre-rendered library (SCAIL-2 offline):** the staple idle/cozy/talk clips, 0 latency.
- **Future bet:** causal-diffusion **full-body** live = Self-Forcing/CausVid base + SCAIL-2
  motion-transfer distilled in. Not today; a real R&D project on a Blackwell.

Alternatives to THA4 for the live face: **LivePortrait** (more neural, less rigging) or
**PersonaLive** (newest, streaming-diffusion). Live2D if you want bulletproof 60 fps and
accept the manual rig.

## Sources
THA4 [project](https://pkhungurn.github.io/talking-head-anime-4/) ·
[arXiv 2311.17409](https://arxiv.org/abs/2311.17409) · THA3 [repo](https://github.com/pkhungurn/talking-head-anime-3-demo) (iFacialMocap/ARKit puppeteer) ·
[LivePortrait](https://github.com/KwaiVGI/LivePortrait) ·
PersonaLive [repo](https://github.com/GVCLab/PersonaLive) / [arXiv 2512.11253](https://arxiv.org/abs/2512.11253) ·
[MirageLSD](https://decart.ai/publications/mirage) ·
[Self-Forcing](https://arxiv.org/abs/2502.08690)-class causal video diffusion ·
[StreamDiffusionV2](https://streamdiffusionv2.github.io/) ·
Live2D + ARKit via [VTube Studio / VBridger / Warudo](https://docs.warudo.app/docs/mocap/face-tracking).
