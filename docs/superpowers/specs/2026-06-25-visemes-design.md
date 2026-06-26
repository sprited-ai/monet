# Viseme lip-sync design — text-driven shapes, audio-driven timing

Date: 2026-06-25
Status: design + build order (research-validated)
Supersedes the "rigged mouth itself" follow-up from the lip-sync v0 spec.

## Goal

Upgrade Monet's mouth from the v0 single amplitude-driven oval to real **viseme lip-sync**:
distinct mouth shapes per speech sound. Two hard requirements (Jin):
- **Text-only (no audio):** when muted / caption-only, derive visemes from the text and play
  on estimated timing.
- **With TTS audio:** the SAME visemes must align to the actual sound.

## Research conclusion (corrects the v0 follow-up's FFT idea)

Web research (2026-06-25, cited in the research log) validated a **text-as-spine** architecture
and corrected one thing: **acoustic/FFT analysis must never *pick* the viseme — only modulate
openness.** Audio can't reliably choose a vowel *shape*; text can. So:

```
TEXT ──G2P──▶ viseme SCHEDULE  [{viseme, charIdx, tStart, tEnd}]
                    │
  MODE A (no audio): play on a speaking-rate timing model
  MODE B (audio):    align charIdx → ElevenLabs /with-timestamps char times
                    │
            + RMS (our existing mouthOpen) = openness MULTIPLIER, not selector
                    ▼
       sprite.frag composites the viseme's mouth shape (procedural → sprite atlas)
```

Same schedule object in both modes; only the **timing source** differs. Same renderer.

## Viseme set — 8 shapes (reduced Oculus/OVR)

| key | meaning | KO trigger | EN (ARPAbet) | procedural {open, width} |
|-----|---------|-----------|--------------|--------------------------|
| `REST` | closed neutral | silence | sil | {0.06, 1.0} |
| `MBP` | lips pressed | ㅁ ㅂ ㅍ (initial/final) | P B M | {0.0, 1.0} |
| `AI` | open wide | ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ | AA AE AH EH | {1.0, 1.0} |
| `EE` | spread narrow | ㅣ ㅡ ㅢ | IY IH | {0.35, 1.3} |
| `OO` | rounded | ㅗ ㅛ ㅜ ㅠ (and w-glides) | OW UH UW W | {0.6, 0.6} |
| `FV` | lip-to-teeth | — | F V | {0.15, 1.0} |
| `L` | tongue-tip | ㄴ ㄹ ㄷ ㅌ (boundary) | N L D T TH DH | {0.4, 1.0} |
| `SS` | mid consonant | ㅅ ㅈ ㅊ ㅋ ㄱ ㅎ | S Z CH SH K G HH | {0.3, 1.05} |

Procedural now; a her-style **sprite atlas** replaces the `{open,width}` ellipse later (same keys).
`width` scales the mouth's horizontal radius, `open` its vertical — both tunable in `/mouth`.

## Korean: pure-Unicode jamo decomposition (no model)

For a precomposed syllable code point `S` in U+AC00…U+D7A3:
```
idx  = S - 0xAC00
cho  = idx / 588 | 0        // initial consonant (19)
jung = (idx % 588) / 28 | 0 // MEDIAL VOWEL (21) — drives the mouth shape
jong = idx % 28             // final consonant (28; 0 = none)
```
The **medial vowel** picks the vowel viseme. A bilabial initial (ㅁㅂㅍ) emits a brief `MBP`
close before the vowel; a final ㄴㄹㄷㅌ can emit a short `L` tail. Non-Hangul: see English.
This is *visual* lip-sync, not linguistic G2P — phonological assimilation is ignored (invisible
for mouth shapes).

## English: CMUdict → ARPAbet → viseme (step 5)

`@stdlib/datasets-cmudict` lookup → ARPAbet phones → the viseme table above, with a crude
letter→vowel fallback for out-of-dictionary words. Deferred to last (Korean is the priority).

## Audio alignment: ElevenLabs /with-timestamps (step 4)

`POST /v1/text-to-speech/:voice_id/with-timestamps` returns `audio_base64` +
`alignment.{characters, character_start_times_seconds, character_end_times_seconds}` (and
`normalized_alignment`). The worker `/api/tts` calls this, returns audio + alignment to the
client; the client snaps each schedule entry's `charIdx` onto the real char times → zero drift.
KO model `eleven_multilingual_v2`. Use `normalized_alignment` if EL expands numbers/symbols.

## Coarticulation (the #1 quality lever)

- Cross-fade adjacent visemes over ~60ms (never snap).
- Drop visemes shorter than ~40ms (skip, don't flash).
- Pre-shape toward the upcoming vowel during a preceding consonant.
- Punctuation → `REST` holds (`.?!`→~300ms, `,`→~150ms).
- Speaking-rate seed: KO ~6 syll/s; vowels ~140ms, consonants ~70ms, stops ~50ms; global `rate` knob.

## Components

- `ui/src/viseme.ts` — pure: `Viseme` keys + `{open,width}` table; `textToSchedule(text, rate?)`
  → `VisemeEvent[]`; Hangul decomposition; (EN later). No deps, unit-testable.
- `ui/src/scene/shaders/sprite.frag` — `mouthDraw` gains `uMouthWide` (h-radius) beside the
  existing `uMouthOpen` (v-radius). Later: sample a viseme atlas instead.
- `ui/src/scene/nodes/CharacterNode.ts` — add `mouthWideSource: (()=>number)|null` → `uMouthWide`
  (default 1), parallel to the existing `mouthOpenSource`.
- `ui/src/MouthLab.tsx` — text input + "play schedule" mode: run `textToSchedule`, drive a clock,
  map active viseme → {open,width} → the two sources. Keeps slider/sine/audio modes.
- worker `/api/tts` (step 4) — switch to `/with-timestamps`, return alignment.

## Build order

1. `viseme.ts`: Viseme set + table + Korean `textToSchedule` (estimated timing). Verify by
   printing schedules for sample KO text (node).
2. `mouthDraw` + `uMouthWide` + `mouthWideSource` wiring. Verify shapes via sliders in `/mouth`.
3. `/mouth` text-schedule mode (no audio): type Korean → mouth lip-syncs on estimated timing.
4. Worker `/with-timestamps` + client alignment → audio-synced schedule.
5. English CMUdict path; then swap procedural shapes → her-style sprite atlas.

Steps 1–3 are dependency-free and self-verifiable (the no-audio path). 4–5 follow.

## Out of scope / later
- Sprite atlas art (procedural shapes first; art is a separate taste/generation pass).
- Per-clip already gated by `mouthRig` (index.json) — visemes only run on riggable talk clips.
