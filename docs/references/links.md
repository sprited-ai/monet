# Reference links

External references (videos, articles) that aren't images. Image references live
in `inspirations/`, `styles/`, `archived/`.

## Videos

- [I Made an AI Character Sit With Me and Have a Conversation (Full Tutorial)](https://www.youtube.com/watch?v=KLswOquhsM8)
  — Prompt Mastery, 18:14, premiered 2026-06-19. AI character that sits with you and
  holds a conversation. Adjacent to the whiteroom: a living being you share a room
  with (`docs/015`, `docs/016`). **This is a real-world SCAIL-2 pipeline walkthrough**
  (see the SCAIL-2 study below) — confirms the seams that matter for Monet.

  Pipeline shown: SCAIL-2 motion transfer → Flux 2 Klein character swap (ComfyUI) →
  custom resolution crop (a tool built with Claude) → CapCut masking/feathering →
  Omni Voice cloning → "Relay Prompt" director control (WAN2GP) → 1080p 30fps.

  Chapters:
  - 00:00 Intro — dragging AI characters into real life
  - 01:15 The solo method — no volunteer needed
  - 02:30 The setup — SCAIL-2 motion transfer explained
  - 03:45 Custom video crop tool (built with Claude)
  - 05:00 Flux 2 Klein character swap in ComfyUI
  - 07:20 Why resolution matching matters for SCAIL-2
  - 09:10 SCAIL-2 replacement workflow
  - 11:30 Masking and feathering in CapCut
  - 13:00 Back to basics — LTX 2.3 22B Distill 1.1
  - 14:15 Omni Voice — voice cloning in WAN2GP
  - 16:00 Relay Prompt — the secret sauce revealed
  - 18:30 The combo: Omni + Relay + 1080p 30fps
  - 20:00 Final result + downloads

  Key practical takeaway echoed across two chapters: **resolution matching is
  critical for SCAIL-2 to work**, and the output is **composited via masking +
  feathering** (it's opaque video, not alpha) — exactly the two seams flagged in the
  Monet study (matte-to-stacked-alpha, ≤1:1 source resolution).

  > Note: YouTube POT-gates the caption track, so the verbatim transcript can't be
  > pulled headlessly; the above is from the description, chapters, and YouTube's AI
  > summary. Linked follow-ups in the video's resources: "SCAIL-2: Character
  > Replacement Tutorial" (below) and a WAN2GP/LTX 2.3 install guide.

- [SCAIL-2: Character Replacement Tutorial (Free Workflow Included)](https://www.youtube.com/watch?v=RQ_gvpdo9ac)
  — Prompt Mastery, 9:34. **Hands-on ComfyUI walkthrough of SCAIL-2** — the practical
  companion to the study. Two free workflows (JSON): **Animation** (drive a reference
  photo with your motion) and **Replacement** (swap yourself for an anime/cartoon
  character, keeping the background). This is the concrete "how to run it" — directly
  feeds the planned gin eval.

  **Exact model set** (all into ComfyUI): SAM 3.1 checkpoint · CLIP Vision · **Wan2.1
  14B SCAIL-2 fp8** diffusion model · image-to-video LoRA · UMT5 text encoder · Wan2.1
  VAE. (fp8 → fits 24 GB.)

  **Hard numbers (RTX 3090, 24 GB):**
  - Resolution via megapixel slider: **0.5 ≈ 480p, 0.8 ≈ 720p**.
  - Render time: **~300 s for 480p anime, ~800 s for 720p**.
  - **81-frame cap** per generation (~2.7–3.4 s of clip); extend via the WAN Context
    Windows workflow.
  - Masking uses **SAM 3.1** (Monet already runs SAM3 for the mouth track).

  **Implications for Monet** (sharpens the study):
  - **Anime/cartoon replacement is the advertised, in-distribution use case** — strong
    de-risk for the chibi, vs. the dead human-skeleton path (`sam-3d-body-not-for-monet`).
  - **Offline clip factory, confirmed:** ~5–13 min/clip. Feeds the stacked-alpha
    library; never a live renderer.
  - **Fidelity tension to test:** native output tops ~720p, but Monet sprites are
    1024–2043 px source (`docs/016`: never scale a sprite above source). So either
    accept 720p generation + upscale, or push the megapixel slider and eat longer
    renders. This is the #1 thing the gin eval must measure.
  - **81-frame cap fits the clip model** — idle/cozy/talk are short gestures, not long
    takes; Context Windows only needed for longer loops.
  - Runs on a single 3090 → gin's newer GPU runs it comfortably; it's a ComfyUI +
    model-download setup, not raw-repo wrangling.
