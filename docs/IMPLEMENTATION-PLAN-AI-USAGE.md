# AI Usage, Knowledge Learning, and Admin UX Implementation Plan

Last updated: 2026-11-17

## Locked Decisions

- Pricing: admin-managed USD only. No hardcoded provider rates and no BDT conversion.
- Answer cache: approved-knowledge FAQs only. Skip cart, order, personalized, and tool-driven turns. Disabled by default.
- Prompts: core safety/business rules live in code. Store-specific overrides are editable and versioned in the database.
- Embeddings: use when configured. Keyword retrieval remains the fallback. No embeddings provider is required for this work.
- Delivery: implement phase by phase and verify each phase before moving on.

## Existing Findings

- The OpenAI-compatible provider discards the final usage chunk because chunks without `choices` are skipped.
- The Anthropic provider does not surface `message.usage`.
- Realtime voice ignores `response.done.response.usage` in `useRealtimeVoice.ts`.
- `AiTurnLog` records outcomes/latency but no tokens or costs.
- Knowledge has no unanswered-question queue, draft/publish versions, or automatic embedding invalidation.
- `EMBEDDINGS_PROVIDER` defaults to `off`.
- The inbox defaults to `attention` when a chat is waiting instead of defaulting to all chats.
- The admin nav is flat; the layout is `max-w-6xl`.
- Prompt text overlaps between base rules, the generic sales playbook, and the industry sales playbook.
- `getProviderHistory` and `summarizeEarlierMessages` query the same messages separately.

## Phase 1 — Schema and Foundations

Status: completed

- Add additive Prisma models:
  - `AiUsageEvent`
  - `ConversationUsageSummary`
  - `ModelPricing`
  - `UnansweredQuestion`
  - `KnowledgeEntryVersion`
  - `AnswerCacheEntry`
  - `PromptVersion`
- Extend existing models with optional fields only:
  - `AiTurnLog`: aggregate usage/cost fields
  - `KnowledgeDocument`: category, keywords, related questions, locale, version, publish/review timestamps
  - `Conversation`: cached context summary fields and usage relation
  - `ChatbotSettings`: optional answer-cache and knowledge-learning flags
- Add shared usage/cost foundations:
  - `src/modules/ai/usage.ts`: normalized usage types and provider mappings
  - `src/modules/ai/pricing.service.ts`: admin pricing lookup and cost calculation
  - `src/modules/analytics/usage.service.ts`: usage event persistence and conversation totals
- Add pricing validation schema.
- Update test fixtures to clear new collections.
- Verify with `prisma validate`, `prisma generate`, and TypeScript.

## Phase 2 — Usage and Cost Capture

Status: completed

- Extend provider done events with normalized usage and provider metadata.
- Parse OpenAI-compatible final usage chunks safely, with fallback when `stream_options` is unsupported.
- Map Anthropic input/output/cache usage.
- Emit one usage event per orchestrator model round.
- Persist text, cascade voice, and realtime voice usage.
- Add an authenticated, idempotent realtime usage endpoint using `response.id`.
- Extend `AiTurnLog` writes with token/cost totals.
- Build `/admin/ai-usage` with date filters, totals, text/voice split, model/provider breakdown, cache-hit rate, top conversations, unpriced warnings, pricing editor, conversation usage card, and CSV export.
- Never backfill or invent historical token usage.

## Phase 3 — Knowledge Learning

Status: completed

- Capture unanswered questions from misses, refusals, errors, and knowledge-search misses.
- Upsert by normalized question hash with occurrence count and last-asked time.
- Add admin tabs: Questions to Teach, Drafts, Published, Needs Review, Archived.
- Add create-answer, link-existing-knowledge, ignore, and resolve actions.
- Add draft/publish workflow and knowledge version history.
- Refresh/invalidate embeddings and answer-cache entries on publish.
- Keep `status = "ready"` as the searchable/published state for backward compatibility.

## Phase 4 — Token and Latency Optimization

Status: completed

- Consolidate duplicated prompt rules with eval coverage.
- Add token-budgeted history and compact tool outputs.
- Cache conversation summaries on `Conversation`.
- Remove duplicate message queries in history/summary loading.
- Filter tool schemas by enabled features and shorten descriptions.
- Limit knowledge snippets and avoid unnecessary retrieval work.
- Enable the approved-knowledge answer cache only behind the feature flag after measuring quality.
- Version store-specific prompt overrides (`PromptVersion`) with history and restore.
- Note: live-model evals (`npm run test:eval`) need `EVAL_AI_*` and were not run here; deterministic prompt tests cover the consolidation.

## Phase 5 — Admin UI and Inbox

Status: completed

- Replace the flat nav with grouped navigation and a responsive SaaS-style shell.
- Add AI Usage under the AI group.
- Inbox defaults to All chats.
- Tabs: All, Needs Human, Unread, AI handling, Resolved.
- Add usage/cost and knowledge-gap context to conversation detail.
- Preserve routes, auth, actions, and handoff behavior.

## Phase 6 — Verification and Rollout

Status: completed

- Unit tests for usage normalization, pricing, token budgeting, dedupe, and cache invalidation.
- Integration tests for usage persistence, realtime idempotency, unanswered questions, knowledge publishing, and inbox filtering.
- Update `.env.example`, `README.md`, and `docs/AI-CHATBOT-GUIDE.md`.
- Run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.

## Acceptance Criteria

- Every live text and realtime voice turn records provider, model, input/output/cache/reasoning tokens, and USD cost when pricing exists.
- Unpriced models are visibly marked instead of assigned invented costs.
- Every conversation can show total tokens and cost.
- Repeated unanswered questions appear in an admin review queue and can become published knowledge.
- Publishing knowledge creates a version and refreshes/invalidates embeddings and caches.
- The inbox opens on all chats, not only handoffs.
- Existing chat, voice, cart, order, handoff, and knowledge behavior remains intact.

## Key Files

- `prisma/schema.prisma`
- `src/lib/validation/schemas.ts`
- `src/modules/ai/provider.ts`
- `src/modules/ai/anthropic.provider.ts`
- `src/modules/ai/orchestrator.ts`
- `src/modules/ai/usage.ts`
- `src/modules/ai/pricing.service.ts`
- `src/modules/analytics/usage.service.ts`
- `src/modules/analytics/turn-log.service.ts`
- `src/modules/conversations/turn.service.ts`
- `src/modules/conversations/conversation.service.ts`
- `src/modules/conversations/summary.service.ts`
- `src/components/chat/useRealtimeVoice.ts`
- `src/app/api/widget/voice/realtime/usage/route.ts`
- `src/app/admin/(protected)/ai-usage/page.tsx`
- `src/app/admin/(protected)/inbox/page.tsx`
- `src/components/dashboard/AdminNav.tsx`
- `src/modules/ai/prompt-versions.service.ts`
- `tests/integration/usage-and-admin.test.ts`
- `tests/helpers/fixtures.ts`
