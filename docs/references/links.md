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
  > Replacement Tutorial" and a WAN2GP/LTX 2.3 install guide.
