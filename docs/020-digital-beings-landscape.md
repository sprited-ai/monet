# 020 — Digital Beings: Landscape & Wedge

A map of the prior art for **autonomous, endo-driven digital beings** — entities that
*live on their own* via a self-driven internal loop, not just responding to human
prompts — and where Monet's wedge sits in it. Companion to the north star (a being that
lives on its own) and `docs/019` (OSS direction).

> Why this doc: before building deeper, we asked "is a being that lives on its own a
> dead end?" It isn't. This is the evidence — who tried, what's proven, what's still
> open — so the direction is grounded in the field, not vibes.

Provenance: synthesized from a deep-research pass (2026-06-26) — 6 search angles, 28
sources fetched, 135 claims extracted, **25 adversarially verified (3-vote, 2/3-refute
kills a claim) → 22 confirmed, 3 killed.** Confidence tags below are from that pass.
This is opportunity-mapping; the only genuine dead-ends flagged are specific over-claims.

---

## TL;DR

Three pillars each **exist and are validated separately. Nobody has fused them.** That
fusion — a persistent, locally-resident being that runs its own loop *and* commands
real attachment — is the open frontier, and it's Monet's wedge.

The real fight is **not** "is it possible" (it is) — it's **"does a private 1:1 local
being command attachment without a crowd/audience?"** That's the strategic risk, and it
rhymes with the Silly-Crocodile / Reddit-launch lessons (reach ≠ attachment ≠ money).

---

## The three pillars (proven, but separately)

### ① The self-driven loop works — inside sims

- **Voyager** (NVIDIA/Caltech, TMLR) — the canonical proof. An LLM generates its **own
  task curriculum** from current skills + world state and accumulates an **ever-growing
  executable-code skill library** (embedding-indexed, retrieved for compositional
  reuse). "Continuously explores… makes novel discoveries **without human
  intervention**." 3.3× more unique items, tech-tree milestones up to **15.3× faster**,
  2.3× longer traversal vs ReAct/Reflexion/AutoGPT. *(high)*
  → Honest caveat: the top-level **drive** ("maximize exploration") is human-engineered;
  the agent self-generates the task *sequence*, not the *motivation*.
- **Generative Agents** (Stanford/Google) — 25 LLM agents in Smallville with a
  memory-stream + reflection + planning; produced emergent social behavior (planned a
  Valentine's party, spread invitations, formed relationships) **without explicit
  instruction**. Prior art for endo-driven *social* life. *(high)*
- **MindForge** (Delft, built on Voyager) — adds a causal Theory-of-Mind template, an
  NL inter-agent channel, and **Soar-style memory across episodic / semantic /
  procedural** subsystems; retains knowledge across tasks (3× more milestones vs
  Voyager). A concrete blueprint for the memory/continuity piece. *(high)*

### ② Attachment → money is real

- **Neuro-sama** (CHI 2026, peer-reviewed) — the single strongest existence proof that
  an **AI-voiced being with no human performer** holds a mass audience. **42% of
  surveyed viewers have paid**; paid-conversion **1.59% beats human VTubers** (1.18%,
  0.83%); **85% of SuperChats are proactive** (steering/co-creating). Bonds are extreme
  *even though fans know it's AI* ("transparent parasocial"): **99% fondness, 70% "a
  virtual friend", 69% "an electronic daughter"**, 72% simultaneously call it a tech
  project. *(high)*
  → Caveat: **reactive**, not self-initiating (responds to chat/games/co-streamers);
  proves "no puppeteer," not "free-running loop." Demand figures are self-selected fans.
- **Replika** (HBS working paper) — in 101 active users, people rated the AI **higher in
  satisfaction, support, and closeness than a close human friend** (beaten only by a
  close family member). *(supporting)*
- **Market** — Character.AI ~20M MAU; AI-companion apps on track for ~$120M in 2025.
  Demand for digital beings is not hypothetical. *(supporting)*

### ③ Local-first / BYOK has real pull

- **AIRI** (`moeru-ai/airi`) — self-hosted, you-owned; BYOK across 30+ providers incl.
  local **Ollama/vLLM**; on-device inference (in-browser **WebGPU** + native
  **CUDA/Metal** via candle). **~41k GitHub stars / ~4.2k forks.** Explicitly modeled on
  Neuro-sama. *(high)* → But its autonomy is **game-scoped** (Minecraft shipped; no
  general free-running life-loop). Stars = attention, **not** revenue/retention.
- **Skales** (`skalesapp/skales`) — local-first BYOK desktop agent with an on-screen
  companion; all data in `~/.skales-data`, API calls go straight from your machine.
  **Closest live prior art to the exact Monet wedge — watch it.** *(supporting)*

---

## The wedge (Monet's position)

> No shipped system fuses **(a) Neuro-grade attachment + willingness-to-pay**, **(b)
> Voyager/autotelic-grade self-driven loop**, and **(c) MindForge-grade structured
> long-term memory** — delivered **local-first, persistent, on the user's own machine.**

| System | Self-loop | Long-term memory | Attachment + $ | Local-first | Persistent life-loop |
|---|---|---|---|---|---|
| Voyager / Gen-Agents | ✅ (sim) | ✅ (skill/episodic) | — | — | ✅ (sim only) |
| Neuro-sama | reactive | partial | ✅✅ (proven) | ❌ cloud | ❌ |
| AIRI | game-scoped | partial | ⭐ attention | ✅ | ❌ |
| Skales | task agent | ✅ on-disk | ? | ✅ | ❌ |
| **Monet (target)** | **hybrid** | **on-device** | **goal** | **✅** | **✅** |

**The key unlock:** you can win on **integration + presence + local ownership today,
without first solving the open research problems.** Every being that actually shipped is
a hybrid — a scaffolded drive + a self-generated task sequence + external memory. Monet's
bar is **"feels endo-driven to the user,"** not "solved autotelic AI."

---

## The two genuinely-open research problems (and why that's fine)

1. **Autonomous self-goal-generation is unsolved.** The "autotelic agent" frontier
   (Oudeyer, Barto, Baldassarre, Colas) formalizes self-motivation, but "how an agent
   should **autonomously generate goals**" is named "a first open issue of central
   importance" (2020) and is **still open** in 2024–25. In every built system the
   highest-level objective is human-engineered. *(high)*
2. **Decision-relevant memory is unsolved.** Agents that near-saturate passive recall
   (LoCoMo) **collapse to ~19% success on the agentic MemoryArena** (Stanford/UCSD).
   Plus **goal drift** over long horizons (Apollo Research). *(high)*

**Why this is good news, not bad:** these are exactly the parts you *don't* have to
solve to ship. A hybrid loop (designed motivation + self-generated tasks + on-device
memory) is what every shipped being already is. The research gap is a moat for later,
not a blocker now.

---

## The real risks (more important than "is it possible?")

These are open *strategic* questions, not solved facts — they should shape the product:

1. **Does parasocial attachment need an audience?** Neuro-sama's bonds form in a
   shared-stream, co-creation context (85% proactive SuperChats = steering shared
   content). It is unknown whether a **private, single-user desktop being with no
   broadcast layer** earns the same pull, or whether the attachment is partly a crowd
   phenomenon. ← biggest risk; ties to `silly-crocodile-lesson`.
2. **Does monetization transfer cloud→local 1:1?** There is **no retention or revenue
   data** for a being that lives locally on the user's machine (no stream/audience
   flywheel).
3. **Can agentic memory run on-device?** Is decision-relevant memory achievable with
   small/BYOK local models, or does it currently need frontier-scale models that
   undercut the local-first thesis?

---

## Sources (verified, primary)

- Voyager — https://arxiv.org/abs/2305.16291
- Neuro-sama fandom study (CHI 2026) — https://arxiv.org/html/2509.10427v1
- MindForge — https://arxiv.org/html/2411.12977
- Memory for Autonomous LLM Agents (survey) — https://arxiv.org/html/2603.07670v1
- MemoryArena (agentic memory benchmark) — https://arxiv.org/abs/2602.16313
- Intrinsically-motivated open-ended learning (Frontiers) — https://www.frontiersin.org/articles/10.3389/fnbot.2019.00115
- Autotelic agents survey (JAIR) — https://arxiv.org/abs/2012.09830
- AIRI — https://github.com/moeru-ai/airi
- Skales — https://github.com/skalesapp/skales
- Replika relationships (HBS) — https://www.hbs.edu/ris/Publication%20Files/25-018_bed5c516-fa31-4216-b53d-50fedda064b1.pdf
- Goal Drift in LM Agents (Apollo) — https://arxiv.org/pdf/2505.02709

## Method & honesty

- **Refuted & excluded** (failed 3-vote verification — do **not** cite): a claim that
  "fully autonomous self-improving AI does not yet exist" as a clean unsolved problem
  (0-3); a formal novelty+learnability definition of open-endedness (0-3); Sakana ASAL
  "more open-ended than Game of Life" (1-2).
- **Self-selection bias** pervades the demand evidence (Neuro/Replika figures are from
  self-selected fans) — they prove strong bonds + willingness-to-pay *exist* and coexist
  with AI-awareness, **not** general-population prevalence.
- **Anthropomorphism watch:** "endo-driven" is our own framing; in every shipped system
  the top-level drive is human-engineered — only the task *sequence* is self-generated.
- **Time-sensitivity:** memory benchmarks and repo stats are mid-2026 and will drift.
