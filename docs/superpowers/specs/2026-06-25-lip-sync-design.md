# Lip-sync design — Monet's mouth moves when she talks

Date: 2026-06-25
Status: design (approved forks, pending spec review)

## Goal

Monet currently renders **mouthless** in the whiteroom: each clip's original mouth is
SAM3-tracked → flat-fill **erased** in `sprite.frag`, frame-exact via WebCodecs
(`CharacterNode` decodes through `StreamingClip`). Her voice is already live (hands-free
Silero VAD → Whisper → Claude → ElevenLabs TTS streaming, `voice.ts` + `Whiteroom.tsx`).

We want her mouth to **move in sync with her speech** — real lip-sync, ending at viseme
shapes, starting at an amplitude-driven procedural mouth.

Hard constraint: Monet's lines are **runtime-generated** (Claude → TTS), never scripted.
So the mouth cannot be pre-baked — it must be driven by the **audio actually being played**.

## Resolved design decisions (the forks)

| Fork | Decision | Why |
|------|----------|-----|
| Mouth art | **Procedural now → viseme sprites later** | Pipeline is the hard part; art drops into the same slot. Start cheap, grow. |
| Visibility | **A1 — always composite our mouth** (always erase original, always draw ours) | One mouth type for rest+speech → no style jump on speech onset; no erase-toggle timing bugs. Rest = neutral (open=0), speech = animated. |
| Placement base | **face rig orientation as the base coordinate frame, our mouth pasted on top** | The mouth follows native head motion (turn/breathe) every frame, so an always-on synthetic mouth never looks "floating". |
| Openness driver v0 | **D1 — amplitude (RMS) from the playing TTS audio** | Free, zero assets, works today; 0 when silent = closed. Viseme classification (D3) comes with the sprites. |
| Start path | **Scaffold pipeline with D1, then drop viseme art + D3 into the same slot** | The frame-exact compositing is the real risk; prove it moving first. |
| Test harness | **Dedicated `/mouth` lab route** (not inside `/preview`) | Isolated test bed like `/voice` and `/webcodex`; keeps `/preview` clean. |

## Architecture / data flow

```
TTS playback (voice.ts) ──AnalyserNode RMS──▶ mouthOpen() : 0..1
                                                    │
mouth.json box   (frame-locked) ──center·width──────┤
face.json mouth kp 24–27 ──────── orientation/tilt──┤
                                                    ▼
                          sprite.frag:  erase original  →  composite our mouth
```

Three units, each independently testable and swappable, plus a harness:

### Unit 1 — Amplitude source (`voice.ts`)
Insert an `AnalyserNode` into the existing speak graph
(`src → g(GainNode) → destination`, line 89) so it becomes `src → g → analyser → destination`.
Export `mouthOpen(): number` returning the current short-window RMS, EMA-smoothed,
mapped to 0..1, **0 when nothing is playing**. Knows nothing about mouth shape — just
"how loud right now".
- Fallback: if no `AudioContext` (the plain `<audio>` path in `speak()`), `mouthOpen()`
  returns 0 → closed mouth, no regression.

### Unit 2 — Driver wiring (`CharacterNode` ← provider fn)
`renderer.character.mouthOpenSource = () => mouthOpen()` (set once in `Whiteroom`).
Each render frame `CharacterNode` reads it, EMA-clamps, uploads as uniform `uMouthOpen`.
No direct `voice.ts ↔ CharacterNode` coupling — only the injected provider function.

### Unit 3 — Mouth compositor (`sprite.frag`)
After the existing erase step, draw the mouth inside the mouth-box UV region:
- **v0 (procedural):** a dark mouth-interior shape whose vertical opening = `uMouthOpen`
  (0 → a thin closed line; 1 → fully open). Simple, no texture.
- **v1 (viseme, later):** sample `uVisemeTex` (a small atlas of her-style mouth shapes) at
  `uVisemeIdx`. Units 1 & 2 unchanged; only this uniform path swaps procedural → texture.

Placement: v0 uses the already-frame-locked **mouth.json box** (`uBoxA/B`) for center+width.
**Orientation (tilt/scale)** comes from **face.json mouth keypoints 24–27**, loaded into
`CharacterNode` the way `mouthFor` loads mouth.json (`faceFor`/`mouthFor` mirror). Box-only
works first; kp tilt is the immediate next refinement.
- Fallback: no face.json → box-only placement, tilt 0.

### Harness — `/mouth` lab (new `MouthLab.tsx`, route in `App.tsx`)
`App.tsx` routes on `window.location.pathname`; add a `/mouth` branch →
`{ page: <MouthLab />, title: 'Monet · Mouth lab' }`. The lab:
- loads one clip via WebCodecs (reuse `WebCodecsStage`/`ClipDecoder`), composites the mouth;
- **`uMouthOpen` slider (0..1)** to hand-tune shape/size/tilt with no audio;
- **synthetic drivers**: manual slider, sine-wave, and a "speak test" button that runs
  real `speak()` so `mouthOpen()` drives it live;
- placement-source toggle (box only vs box + face-kp tilt);
- later: a viseme-atlas preview + index picker.

This is the tuning surface for Unit 3 in isolation, before it goes live in the whiteroom.

## Viseme upgrade path (later; slot is pre-built)
1. **Art**: 6–12 her-style mouth shapes (ㅁ/ㅂ/ㅍ closed · 아 open · 이/에 wide · 오/우
   round · 으 slight · neutral). Generated (FLUX-Kontext / THA4) or hand-drawn → packed
   into one atlas texture, each cropped to sit at the mouth box.
2. **Selector (D3)**: audio → viseme class per moment (formant/energy rule or a tiny model,
   or TTS-provided timing). Sets `uVisemeIdx`. Only Unit 3's uniform path changes.

## Verification
- **Unit 3 shape**: tune in `/mouth` via the slider — visual.
- **Unit 1 amplitude**: drive `/mouth` with the sine generator (no audio) and with a real
  `speak()` call; confirm `mouthOpen()` tracks loudness and returns to 0 on silence.
- **Frame-lock**: confirm the mouth stays on the lips while the clip plays / head turns
  (same frame index as erase → exact by construction).
- **Live**: in the whiteroom, trigger a reply and watch the mouth move with her TTS, close
  on silence, follow head motion.

## Error handling / fallbacks
- No `AudioContext` → `mouthOpen()=0` → closed neutral mouth.
- No face.json → box-only placement, no tilt.
- WebCodecs unsupported (iOS<16.4) → character already doesn't render there; no new path.

## Out of scope (YAGNI for v0)
- Viseme art + D3 selector (designed, deferred to the next stage).
- Mixing native mouth open-height as a base (left as a possible later nuance; v0 fully
  drives openness).
- Formant/D2 driving on the procedural mouth (skipped — D3 is the real answer with sprites).
- Pre-baking (runtime only; voice is live).

## Build sequence
1. `/mouth` lab route + harness shell (clip via WebCodecs, slider).
2. Unit 3 v0 procedural mouth in `sprite.frag` (box placement) — tune via slider.
3. face.json kp tilt into placement.
4. Unit 1 AnalyserNode + `mouthOpen()` in `voice.ts`; sine + speak-test in the lab.
5. Unit 2 provider wiring; go live in the whiteroom.
6. (later) viseme atlas + D3 selector into the same slot.
