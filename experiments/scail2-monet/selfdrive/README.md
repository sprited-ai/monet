# selfdrive — endo-driven Monet (the living-agent proof)

The counterpoint to the puppet/VTuber path ([[living-agent-not-vtuber]]): drive Monet's
body from **her own generated state**, with **no human in the loop**. First proof, 2026-06-24.

## What it does
```
her line (text) → TTS (her voice) → audio amplitude envelope → visemes
                                   + emotion + life (breathe / sway / gaze / blink)
                                   → THA4 pose vector per frame → render
```
- `tha4_drive.py` (local) — **the driver.** Reads her speech wav + an emotion, emits a
  per-frame THA4 pose vector: mouth from the audio envelope, plus emotion bias and
  procedural life signals. **Nothing comes from a webcam/ARKit** — the body is moved by her
  voice + state. This is the whole point.
- `tha4_talk.py` (gin) — renders the pose sequence through THA4's full poser
  (`experiments/tha4`), one frame per vector → silent mp4. Audio is muxed back on the Mac.

## Result
- `monet_selfdrive_talk.mp4` — Monet speaking a line, **self-driven**. Audio = her (placeholder)
  voice via macOS `say`; everything visual generated from it + state.
- `selfdrive_talk_montage.webp` — head sway, breathing, gaze drift are clearly alive.
- Render speed on gin's Blackwell (full, *non-distilled* poser): **~23 fps (43 ms/frame)** —
  already near real-time; a distilled THA4 student model would be well past it.

## Honest limitation (and the fix)
`lipsync_quiet_vs_loud.webp`: the **mouth barely opens** even at high viseme gain. Cause:
Monet's THA4 input (`monet_512.png`) has a **closed smile + closed eyes** rest pose, so
THA4's morpher has little to deviate from. This is a *renderer* limit, not the architecture.
Fixes, in order of effort:
1. A proper Monet **talking base image** — neutral/open eyes, slightly-open neutral mouth —
   plus a face-organ mask. (THA4's documented input constraint.)
2. **Distill a THA4 student model** on that base (THA4-4's intended path): better range +
   true real-time. `experiments/tha4` has the distiller.
3. Or drive the mouth via Monet's existing SAM3 mouth-erase/reinpaint pipeline
   ([[monet-face-rigging-pipeline]]) instead of THA4 morphing.

## Why it matters
This is the **endo-driven** half of the body, the thing that makes her *alive* rather than a
puppet. The architecture is renderer-agnostic: `state → params → render`. Swap THA4 for a
better face renderer and the driver is unchanged. Layered with SCAIL-2 (offline rich
gestures) and her conversation loop, this is the spine of a living agent
([[jin-intention-living-ai]]).

## Next
- Make a neutral-rest Monet talking base + distill a student model → expressive real-time face.
- Wire the driver's input to the real loop (her LLM speech + emotion state) instead of a
  hand-written line + macOS TTS; swap `say` for her cloned voice.
