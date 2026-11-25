# AI token & cost audit: voice (Gemini Live) and text (Gemini 3.8 Flash)

## Context
The owner asked for a production-level audit of token consumption and cost for the voice and text assistants. The goal is to cut waste without lowering answer quality, voice naturalness, context retention or speed. **The audit is read-only: no code was changed.** Each optimization below is implemented only when chosen, behind the benchmark gate in Part 7.

### Evidence used
- **Real production usage** (`AiUsageEvent`, read-only): 154 Gemini Live responses across 7 real calls, with the provider's own usage breakdown, priced with the store's price table (`ModelPricing`). There is no real text baseline: all 4 text turns since 24 Nov failed on the free-tier quota.
- **Live test runs (25 Nov):** voice checkup (68 responses, 45 checks) and text checkup (51–54 requests, 24 checks), through the real routes on real models.
- **Code:** request lifecycle traced end to end (files cited inline).
- **Official Gemini docs:** caching, pricing, Live session management, thinking, tools.

---

## Part 1 — Current architecture (from the code)

### Text chat (`/api/widget/message` → `turn.service.ts` → `orchestrator.ts` → `provider.ts`)
- **Model:** set in Admin → AI model; currently `gemini-3.8-flash` through Gemini's OpenAI-compatible endpoint. `reasoning_effort` comes from Admin Effort (low/medium/high). `max_tokens` isn't sent to Gemini, and neither is temperature on Gemini 3 models.
- **The prompt each request sends** (`buildSystemPromptParts`):
  - **Stable instructions:** about **9,950 characters**. Rules, persona, store facts, sales playbook and owner instructions, identical for every turn of a store.
  - **Per-turn block:** about **865 characters**. Customer, cart, open order, next step, conversation summary, sales hint.
  - **Merged into one system message:** `toOpenAiMessages` joins them because some compatible servers reject two system messages. **So the per-turn block sits inside the system instruction, ahead of the tools and history.**
  - **Tool definitions:** **19 tools, about 13,200 characters** of JSON. Cart-only tools and `confirm_order` are left out when they can't succeed (`getProviderTools(state)`).
  - **History:** the newest messages up to a **6,000-character budget** (`buildProviderHistory`), plus a **deterministic summary** of older turns (`summary.service.ts`, no extra model call). It includes "On screen" notes with product ids and versions.
- **Tool loop:** up to 2 tool rounds plus a final text-only round (`MAX_TOOL_ITERATIONS = 2`). Read-only tools run in parallel. Tool results are compacted, capped at 12,000 characters, and the browse result is minimal. A retry runs if the model returns no text (added 25 Nov).
- **Caching:** nothing explicit for Gemini (the `cache: true` hint only affects Anthropic). Gemini's implicit caching applies automatically when a request's prefix matches a recent one.
- **Other model usage:**
  - Embeddings: off (`EMBEDDINGS_PROVIDER=off`).
  - Knowledge answer cache: exists but is off by default.
  - Summaries: no model calls.

### Voice (Gemini Live, `gemini-3.8-live`, audio to audio)
- **Session setup** (`createGeminiLiveSession` → `geminiLiveSetup`): instructions of about **15,600 characters**. These are the text instructions above plus `liveCallRules`, `SOUND_HUMAN`, `GEMINI_CALL_RULES` and the language reminder.
- **Tools:** **20** (the text tools plus `end_call`), about **13,500 characters**.
- **Other settings:**
  - Transcription both ways, with Bangla/English hints.
  - Voice detection: start sensitivity LOW, end sensitivity LOW, 650 ms silence.
  - Context compression triggers at 24,000 tokens and cuts back to 12,000.
  - Session resumption for connection rotation.
  - The setup is locked into a single-use token.
- **Browser** (`useGeminiLiveVoice.ts`):
  - Streams 16 kHz PCM in 40 ms chunks.
  - Echo gate: while the assistant speaks, audio is held back until there's sustained loud speech.
  - Noise and echo transcripts are not saved.
  - Tool calls go to `/api/widget/voice/realtime/tool`, which runs the same tools as text. Results are compacted (≤6,000 characters) and carry `nextFiller` and `orderState`.
- **Where the context lives:** in Gemini's session (instructions, tools, every audio turn, transcripts, tool results). Our server sends nothing more per turn.
- **There is no separate Gemini Flash call in the voice pipeline.** Live does hearing, reasoning and speaking in one model. `gemini-3.8-flash` is only the text model.

---

## Part 2 — Where the tokens and money go (measured)

### Voice: production, 154 responses, 7 calls, the store's prices ($/1M: text in 0.75, audio in 3.00, text out 4.50, audio out 12.00)

| Per model response (average) | Tokens | ≈ Cost | Share |
|---|---|---|---|
| Text input: instructions + tools + transcripts + tool results | 8,686 | $0.0065 | ~50% |
| Audio input: every earlier customer utterance stays in context and is re-billed | 1,458 | $0.0044 | ~33% |
| Audio output | 80 | $0.0010 | ~8% |
| Thinking (built into 3.8 Live, not configurable) | 101 | $0.0005 | ~4% |
| Cached | **0** | n/a | Live doesn't support context caching (docs) |

- **Recorded totals:** $2.12 for 154 responses, i.e. **$0.0137 per response**, **about 22 responses and $0.30 per call**.
- **The fixed part is large:** the first response of a call already carries **~7,200–7,900 text tokens** (instructions + tools). That's about **86% of the average text input** in a real call, re-billed on every response. Input grows to 12–20k in long calls; compression at 24k never triggered (max seen 19.8k).
- **A turn with a tool costs 2 responses** (filler + tool call, then the answer): **~17,800 tokens** versus ~11,500 for a turn without tools (voice checkup).
- **Phantom turns:** in the complaint call (69 responses), roughly a third of the responses answered noise or echo ("¿Qué", "de"). Each one is a full ~12k-token response. Fixed on 25 Nov (echo gate, voice detection, noise filter); not yet measured in production.

### Text: test runs; the same prompt and tools as production

| Per customer turn | Value |
|---|---|
| Model requests | 2.2 on average (histogram: 1×4, 2×12, 3×7, 4×1) |
| Input per request | ~5,400–5,900 tokens |
| Cached share | **~20%**, and only *within* a turn (4,032 cached on round 2) |
| Output | ~25–60 tokens per turn |
| ≈ Cost per turn on `gemini-3.8-flash` | **~$0.0076** (input ~95% of it) |

**Why the cache barely helps (verified):** Gemini's implicit caching needs a matching **prefix of at least 4,096 tokens** on 3.8 Flash (docs). Our per-turn block changes every turn and sits inside the system instruction, *before* the ~3,300 tool tokens and the history. The prefix shared across turns is therefore only the ~2,500-token stable instructions, below the minimum, so cross-turn caching never fires. Within a turn, rounds 2–3 share everything, which is the 4,032 cached we see.

### Already efficient (no change recommended)
- **History:** capped at ~1.5k tokens, with a deterministic summary and no extra model calls.
- **Tool results:** compacted, and the browse list is minimal.
- **Output:** tiny; replies are short by design.
- **Thinking:** text runs at low effort; voice can't be configured.
- **Embeddings:** off.

---

## Part 3 — Opportunities, ranked

**Verified** = mechanism and baseline measured. **Theoretical** = plausible, must be proven by the A/B in Part 7.

| # | Opportunity | Saves | Latency | Quality risk | Complexity | Status |
|---|---|---|---|---|---|---|
| **T1** | **Cache-friendly text prompt order:** stable instructions → tools → history first, the per-turn block last | Text input **cost −55–65%** (cached share 20% → 70–80%); token count unchanged | Slightly better | Medium (the per-turn block moves) | Low–Med | Verified |
| **V1** | **Shorter voice session prompt** (15.6k characters: dedupe rules across base/voice/live/Gemini/language blocks) | ~1.2–1.6k text tokens **per response**, **≈ −10–13% voice cost** | Slightly better | Medium | Medium | Theoretical |
| **TD** | **Shorter tool definitions** (13.2–13.5k characters, ~40% of the fixed part; shared by voice and text) | ~1.0–1.5k tokens per request/response: **voice ≈ −8–10%, text ≈ −20% input** | Same | Medium | Medium | Theoretical |
| **V4** | **Phantom-turn fix**, already shipped; confirm in production | Up to ~30% of responses in noisy calls | Better | Positive | Done | Verify |
| **V3** | **Smaller tool results that stay in the call** (browse list with variants ≈ 400–600 tokens re-billed on every later response) | −5–10% text input in later turns | Same | Low–Med | Low | Theoretical |
| **T5** | **Skip the extra text round for page-opening tools** (`open_product_page`, `go_to_checkout`): a fixed short reply in the customer's language | One request (~5.5k tokens) on those turns; −1–3 s | Better | Low | Low | Theoretical (low frequency) |
| **V2** | **Voice-only tool set:** leave out tools voice never uses; decide from tool-usage logs | ~300–600 tokens per response | Same | Low–Med | Low | Theoretical |
| **T4** | **Dedupe the stable text instructions** (9.9k characters) | −15–25% of the stable part | Same | Medium | Medium | Theoretical |
| **T2** | **Explicit Gemini cache** per store (instructions + tools) via `extra_body.google.cached_content`; only if T1's hit rate is below ~60% | 90% off the cached part; storage ≈ $0.003/hour/store | Same | Low | Med–High | Conditional |
| **V5** | **Rebase long calls:** move earlier *audio* turns into a short text summary (docs: "provide a single message summary"), since audio is 4× text and ~33% of cost | 15–30% on long calls | Risk of a brief gap | Medium | High | Theoretical |
| **X1** | **Paid tier on Google** (the free tier allows 20 requests/day/model) | Availability, not tokens | — | Critical | Config | Verified |
| **X2** | **Complete the price table:** add the backup model `gemini-flash-lite-latest`, and audio prices for every live model | Correct cost tracking | — | — | Low | Verified gap |

**Not recommended (they would cost quality or speed, or aren't supported):**
- Lowering audio quality: the token rate is fixed.
- Shorter or fewer spoken replies: replies are already one short sentence.
- Removing the "one moment" fillers: UX.
- Lowering the compression trigger.
- `thinkingLevel` on 3.8 Live: unsupported.
- Downgrading models.
- Trimming history further: it's already ~1.5k tokens with a summary.

---

## Part 4 — Voice plan (Gemini Live)

1. **Verify V4 first (no code):** after deploying the 25 Nov fixes, compare **responses per customer turn** and **phantom user lines** in `AiUsageEvent`/`Message` for 7 days against this baseline (22 responses per call; ~1/3 phantom in noisy calls).
2. **V1 + TD + V2: slim the fixed context.** This is the only lever on the 50% text-input share, because Live has no caching.
   - **Instructions:** merge duplicates:
     - language rules appear in base rule 1, `languageReminder` and `SOUND_HUMAN`;
     - ordering steps appear in base rules, `nextOrderStep` and `GEMINI_CALL_RULES`;
     - filler and noise rules appear twice.

     Move fixed examples into shorter patterns. Keep every behaviour rule (the gate in Part 7 checks each one).
   - **Tools:** shorten descriptions and parameter descriptions (keep names, schemas and constraints).
   - **Tool set:** derive the voice set from real usage logs.
   - **Target:** fixed part 7.5k → ~5–5.5k tokens; voice cost ≈ −15–20%.
3. **V3: smaller tool results that persist.** On calls, keep variants only for single-product results, and use names + ids for browse lists. `productIdAtPosition` and `add_to_cart` already resolve by name and position.
4. **V5 (long-term): rebase long calls.** When audio tokens in context pass a threshold (e.g. >5k, typically after 15–20 turns), open a new session with a text recap (transcripts + cart + order state) instead of the audio. Use the existing grant flow and swap without a gap, like the session resumption path. Only if production shows many long calls.
5. **Keep as is:**
   - voice detection, transcription and audio format (fixed token rate);
   - context compression at 24k (never reached; lowering it risks forgetting);
   - fillers;
   - thinking (not configurable).

## Part 5 — Text plan

1. **T1: cache-friendly order** (`provider.ts` `toOpenAiMessages`, `orchestrator.ts`).
   - Keep only the stable instructions in the system message.
   - Send the per-turn block as a short context message placed after the history, directly before the latest customer message. Use a "[shop system: …]" note in that user turn, for Gemini only, behind a provider check.
   - Result: tools + stable instructions + history form a prefix of more than 4,096 tokens that repeats across turns and rounds.
   - Measure `cachedInputTokens` share; the target is ≥70%.
2. **TD/T4: shorter tools and instructions**, shared with voice, so it's done once.
3. **T5: one fewer round for page-opening tools.** When the only tool calls in a round are `open_product_page`/`go_to_checkout` and they succeeded, finish with a fixed localized line instead of another model request.
4. **T2 only if needed:** an explicit cache per store and model, refreshed on settings change, via `extra_body`. Skip it if T1 already reaches ≥70% cached.
5. **Keep as is:** the history budget and summary, tool-result compaction, output settings and low effort.

## Part 6 — Roadmap

- **Quick wins (1–3 days each, each behind the Part 7 gate):**
  - X1 paid tier;
  - X2 price table;
  - V4 production verification;
  - **T1** cache-friendly order;
  - V3 smaller persistent tool results;
  - T5.
- **Medium term (1–2 weeks):** TD + V1 + V2 + T4, with one prompt/tool slimming pass shared by voice and text, A/B tested.
- **Long term:** T2 explicit cache (only if T1 falls short); V5 rebasing long calls (only if production shows many long calls).
- **Expected combined, if the A/B confirms:**
  - **text cost per turn ≈ −60–70%**, mostly caching and partly fewer tokens;
  - **voice cost per response ≈ −15–25%**, plus the phantom-turn reduction on noisy calls.

These are estimates, not guarantees.

## Part 7 — Benchmarking and validation

- **Quality gates (existing suites):** `tests/eval/voice-checkup.eval.ts` (45 checks: products, cart, ordering, pages, language, listening, noise) and `tests/eval/text-checkup.eval.ts` (24+ checks).
  - **Add:** a 25-turn long-conversation scenario (recall of name, size and cart from early turns), an interruption/barge-in scenario, and a scenario where several tools are called in one turn.
- **A/B method:** run baseline and candidate **3 times each** on the paid tier, with the same model, store copy and scenarios.
- **Accept a change only if all of these hold:**
  - pass rate ≥ baseline (no check that passed in all baseline runs may fail);
  - tokens or cost per turn drop by ≥10%;
  - median and p90 latency are within +5% (first audio for voice, first words for text);
  - cached share is reported separately from token count (caching cuts cost, not tokens).
- **Production check (7 days before vs after),** from `AiUsageEvent`/`AiTurnLog`:
  - tokens and cost per response and per customer turn;
  - responses per call;
  - cached share;
  - error and miss rate;
  - p50/p95 latency;
  - tool calls per turn.

  A small admin "AI usage" addition for the text vs audio prompt split makes this visible.
- **Voice naturalness:** listen to 10 recorded test calls per variant (transcripts and timing from the checkup JSON), and spot-check real calls in the inbox.

## Implemented on 25 Nov 2026 (first batch)

| Item | Change | Measured |
|---|---|---|
| T1 | Text: the per-turn block (cart, customer, next step) is sent as a `[SHOP CONTEXT]` note right before the customer's latest message (`orchestrator.ts`, `provider.ts`); the system message no longer changes between turns. A rule tells the model the note comes from the shop. | Cached share on `gemini-3.5-flash-lite`: 19% → 26% overall, rising to 33–47% from the 3rd turn of a conversation. The first request of a conversation still isn't cached: Gemini's compatibility endpoint doesn't seem to count the tools in the cached prefix, so the shared opening is under 4,096 tokens. **T2 (explicit cache) is needed for short chats.** |
| T5 | Text: a round that only opens a page (`open_product_page`, `go_to_checkout`) ends with a fixed line in the customer's language, so there's no extra model request. | Unit tested; saves one full request (~5.5k tokens, 1–3 s) on those turns. |
| V2 | Voice: no `prepare_checkout` / `save_customer_details` (text-checkout tools) on calls; the voice rule points to `go_to_checkout`. | Voice tool definitions 13,486 → 12,394 characters. |
| V1 | Voice: the Gemini-only rule block cut from ~1,330 to ~500 characters (duplicates of shared rules removed; "search before talking about products" and "look up product questions" kept). | — |
| V3 | Browse results no longer carry every product's versions (they stay in a call's memory); `add_to_cart` resolves versions and sizes by name. | — |
| Fixes found while testing | Cart remove/update accept the product name (a mis-copied id failed and wasted rounds). "Number N" / "open its page" work for a list shown earlier in the same reply. | Integration tested. |

**Voice A/B (live, `gemini-3.8-live`):**

| | Baseline | After |
|---|---|---|
| Text input per response | 8,769 tokens | **8,444 tokens (−3.7%)** |
| Checks passed | 42/45 | **46/47** |
| First audio | 836 ms median / 1,490 ms p90 | 875 ms / 1,540 ms (within run-to-run variation) |

**Text A/B:** only partly done. Google's free-tier daily limits stopped every run after about 10 turns, so the order flow wasn't re-run on the real model. The 10 turns that ran all passed, except one cart removal that failed on a mis-copied id (fixed afterwards).

**Next:**
- X1: paid tier.
- X2: prices for `gemini-flash-lite-latest`.
- T2: explicit cache of instructions + tools for text, the remaining big text saving.
- TD + T4: careful description trimming, each A/B-tested.
