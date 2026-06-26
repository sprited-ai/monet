# Out-of-vocabulary (OOV) for Monet — options to recognize "Sprited", "Monet", "제인"

_The problem (deep-dive on [`RESEARCH.md`](./RESEARCH.md)): STT mangles coined/proper words it never trained on — "sprited" → "스프라이데드 / brided". The Web Speech API the lab uses has **no** vocabulary control (its `SpeechGrammarList` is a no-op in Chrome), so it can't be fixed there. Below are the real options, with 2026 specifics._

The field is **contextual biasing / speech adaptation** at recognition time, plus **post-ASR error correction** after. Options, ranked for Monet:

## A. Deepgram Nova-3 / Flux — Keyterm Prompting  ★ primary fix
Pass a list of our world's terms; the model biases toward them **at inference via in-context learning** (not dumb post-processing).
- Up to **100 keyterms** (Nova-3); **multilingual** keyterm prompting passes up to ~500 tokens (~100 words) and prioritizes them **across languages in one request** — fits our KO+EN.
- Reported **+up to 90% keyword recall** for proper nouns / brands / domain terms.
- Works on **Flux** too (the streaming, turn-detecting model we already favored).
- → Feed `["Sprited", "Monet", "제인", …]`. This is the clean primary fix when we move off Web Speech.
- Docs: [Keyterm Prompting](https://developers.deepgram.com/docs/keyterm), [multilingual keyterm](https://deepgram.com/learn/deepgram-expands-nova-3-with-10-new-languages-and-multilingual-keyterm-prompting).

## B. Phonetic post-ASR correction  ★ cheap complement, works with ANY STT
Keep a small canonical term list; after STT, match mis-heard tokens by **how they SOUND** and replace with the canonical spelling (스프라이데드 → Sprited).
- Use **acoustic / phonetic** matching (Metaphone/Double-Metaphone, Soundex, or edit-distance on a romanized/phonetic form), NOT just semantic.
- 2025 research confirms the key point: **pure-LLM correction struggles to introduce truly OOV names** (LLMs favor frequent words), so the winning methods are **retrieval-augmented** with **acoustic neighbor embeddings** (>4% higher entity recall than semantic) — i.e. match by sound ([DeRAGEC](https://arxiv.org/pdf/2506.07510), [retrieval-augmented NE correction](https://www.researchgate.net/publication/390536206_Retrieval_Augmented_Correction_of_Named_Entity_Speech_Recognition_Errors)).
- For us: a tiny phonetic dictionary of Monet's vocab → correct the displayed transcript. And our Claude already understands the gist in context, so the *conversation* isn't broken regardless.

## C. OpenAI gpt-4o-transcribe — `prompt` biasing
The `prompt` field takes a short keyword list (domain vocab / spelling) to steer recognition ([speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)).
- "Aid, not a guarantee" — still verify high-value entities.
- ⚠ On **silent/short** audio it may **hallucinate the glossary words** even if unspoken — risky for an always-on mic.
- ⚠ `gpt-realtime-whisper` (GA Realtime) does **not** support `prompt`; only the `gpt-4o-transcribe` streaming path does.

## D. Browser / offline — Vosk (custom vocabulary)
If we want a **free, on-device** path that *can* bias vocab (unlike Web Speech):
- **Vosk** small models (~50MB) support **runtime-reconfigurable vocabulary** — constrain/inject a word list at runtime; runs in the browser ([vosk-browser](https://ccoreilly.github.io/vosk-browser/), [vosk-api](https://github.com/alphacep/vosk-api)).
- **Whisper** contextual biasing via a neural-symbolic prefix tree, or `initial_prompt` seeding ([Whisper contextual biasing](https://arxiv.org/html/2410.18363v1)) — heavier, Korean quality varies.
- Trade-off: Korean accuracy below Deepgram; client CPU + model download.

## Recommendation for Monet
1. **When we move off Web Speech → Deepgram keyterm prompting (A)** with Monet's vocab list. Primary, multilingual, streaming.
2. **Add phonetic post-correction (B)** against the same term list — cheap, STT-agnostic, fixes the displayed transcript; pairs with Claude's contextual understanding.
3. Web Speech (lab) **can't** be fixed → it's a stopgap; the OOV pain is another reason to graduate to Deepgram.
4. Don't lean on **pure-LLM** correction for OOV (research: it can't reliably introduce names it can't infer — needs phonetic/retrieval).

Maintain one **canonical vocab list** ("Sprited", "Monet", "제인", …) and feed it to BOTH the keyterm prompt (A) and the phonetic corrector (B).
