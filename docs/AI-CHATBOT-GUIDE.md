# How the Nokshi AI shopping assistant works

This guide describes the current implementation in this repository: what the project is, the customer-facing chat widget and voice assistant, what the AI does on each turn and how, the admin dashboard and Inbox, and how store information reaches the assistant. File paths are relative to the repository root.

_Last verified against the code: 2026-11-03._

## In brief

Nokshi is a **Next.js 15 storefront with a built-in AI sales assistant**, aimed at a Bangladeshi shop (BDT prices, Bangla + English, cash on delivery). A customer can chat or talk to the assistant to find products, build a cart, give delivery details, place a cash-on-delivery order, and check order status. When the assistant can't help, the chat moves to a human agent in the admin **Inbox**.

The assistant is **an application around a language model, not a model trained on the store's data**. On every turn the server:

1. builds a system prompt from fixed rules, store settings, the live cart, saved customer details, and the next order step;
2. sends that prompt, the recent chat history, and 18 tool definitions to the configured model;
3. runs any tool the model asks for (search products, add to cart, propose an order, …) against MongoDB, after validating the arguments;
4. streams the model's short reply and the tools' cards (products, cart, order summary) to the widget.

The model chooses what to do. The application owns every fact (prices, stock, totals, policies, order state) and performs every write.

There is no fine-tuning, embeddings pipeline, or vector database. In this project, "training" means keeping the catalog and knowledge documents accurate and configuring the assistant's instructions in the dashboard.

## Tech stack

| Layer | What is used |
|---|---|
| Web app | Next.js 15 (App Router), React 19, Tailwind CSS |
| Database | MongoDB through Prisma 6 (`prisma/schema.prisma`); must be a replica set because orders use transactions |
| Validation | Zod (request bodies, tool arguments, environment) |
| AI (chat) | Anthropic Claude via `@anthropic-ai/sdk`, or any OpenAI-compatible `/chat/completions` API via `fetch` |
| AI (voice) | OpenAI Realtime API over WebRTC, or a speech-to-text → chat model → text-to-speech pipeline using Azure, OpenAI, or the browser |
| Tests | Vitest + `mongodb-memory-server` (unit/integration), Playwright (end-to-end, desktop and mobile) |

## Architecture at a glance

```
Browser (storefront + chat widget)                 Next.js server                          External
───────────────────────────────────                ──────────────                          ────────
ChatWidget ── POST /api/widget/session ──────────► session.service ─────────────► MongoDB
           ── POST /api/widget/message  (SSE) ───► turn.service
           ── POST /api/widget/voice/turn (SSE)        ├─ handoff checks
           ── GET  /api/widget/messages (poll)         ├─ ai/run.ts ─ live? ─► orchestrator ──► Claude / OpenAI-compatible
                                                       │                 └─► demo-assistant (no model)
                                                       └─ ai/tools/* ─► cart / catalog / orders / knowledge services ─► MongoDB
Realtime voice ── WebRTC audio ───────────────────────────────────────────────────────────────► OpenAI Realtime
               ── POST /api/widget/voice/realtime/{session,tool,transcript} ─► same tools + conversation store

Admin dashboard (/admin) ── server actions ─► same services (Inbox, orders, catalog, knowledge, AI settings)
```

## What the customer sees

The widget (`src/components/chat/`) is mounted on every storefront page. On startup it calls `POST /api/widget/session`, which validates the store's public widget key, creates or resumes the chat session, conversation, and active cart, and returns the last 80 messages, the cart, the widget settings, and whether the AI is `live` or `demo`. A signed, HTTP-only cookie identifies the session afterwards. A visitor ID kept in browser storage links repeat visits to saved customer details; if browser storage is blocked, chat still works but the visitor isn't recognized on the next visit.

The widget offers:

- **Text chat** with streamed replies and suggested topic badges.
- **Cards** rendered from structured "UI parts", not from model text: product lists with variants and *Add* buttons, filter chips (color, brand, material, …), cart summary, contact-details form, order summary with *edit* and *confirm*, order-status progress, and handoff notices.
- **Attachments**: JPEG/PNG/WebP/GIF images, PDFs, and voice notes (WebM/OGG/MP4/MPEG/WAV), up to 5 MB each.
- **Voice**: hands-free voice conversation (see [Voice](#voice)).
- **Product-page greeting**: on a product page, a greeting plus a factual overview (name, brand, first sentence of the description, price, available variants, a few attributes) assembled from the catalog without calling the model. It is sent once per product per conversation.
- **Welcome back**: a returning visitor's voice greeting picks up what they left unfinished: an order waiting for confirmation, items in the cart, an order from the last 7 days, a product shown in the last 14 days, or an earlier conversation (`src/modules/conversations/reminder.service.ts`).

Agent replies and order/handoff events arrive by **polling** `GET /api/widget/messages`: every 3 s while a human is involved and the widget is open, every 15 s otherwise while it is open, every 10 s in the background during a handoff, and not at all when it is closed and the AI is in charge.

## A text-chat turn, end to end

Code: `src/app/api/widget/message/route.ts` → `src/modules/conversations/turn.service.ts` → `src/modules/ai/run.ts` → `src/modules/ai/orchestrator.ts`.

1. **Check and store the message.** The route rate-limits (60 messages/min per IP, 20 per session), validates the body, confirms the conversation belongs to this session and isn't closed, attaches any previously uploaded files, and saves the customer message.
2. **Respect a human handoff.** If the conversation is `waiting_human` or `human`, the message is stored for the agent and the AI does not reply.
3. **Check handoff keywords.** If the text matches a configured keyword (whole-word for Latin script, substring for Bangla), the conversation is handed off before the AI runs.
4. **Handle file-only messages.** A message with only attachments and no text gets a fixed reply (for example, asking the customer to type a voice note that couldn't be transcribed); the model is not called.
5. **Capture a spoken phone number.** If the text contains a phone number, including digits spoken in Bangla or English words, it is saved to the customer profile.
6. **Build context.** The server loads the server-calculated cart and the last **20** user/assistant/agent messages. In that history:
   - staff replies are prefixed `[Reply from store staff <name>]`;
   - attachments become notes such as `[Customer attached an image: photo.jpg]` or `[Voice message, transcribed: "…"]`;
   - each assistant message is followed by `[On screen with this reply: …]`, listing the product IDs, variant IDs, and stock shown, the cart, or an order-summary card, so the model can refer to "the second one" without guessing IDs.
7. **Pick live or demo mode.** If a usable AI connection exists (see [Model configuration](#model-configuration)), the live orchestrator runs; otherwise the rule-based demo assistant does.
8. **Run the tool loop.** The orchestrator streams the model's reply (temperature 0.2 for OpenAI-compatible providers). If the model asks for tools, each call is validated and executed, its result (truncated to 12,000 characters) is returned to the model, and any cards are streamed to the widget immediately. The model gets up to **5 tool rounds** per turn. If it is still calling tools after the fifth, one more call is made with `tool_choice: "none"` so it must reply in text from the results it already has.
9. **Save and report.** The reply text and its cards are saved as one assistant message. The turn is recorded as answered or **missed**, and any handoff that happened during the turn (from the `request_human` tool or the miss counter) is sent to the widget.

The response is a server-sent event (SSE) stream with these events: `message.started`, `message.delta` (text), `ui.part` (a card), `ui.cart`, `message.event` (handoff/order notices), `conversation.mode`, `message.completed`, and `message.error`.

**Misses and failures.** A turn is a miss when the model refuses (Claude's `refusal` stop reason) or ends with no text. The customer then sees the store's fallback message. A provider or server error shows a retryable error and also counts as a miss. After the configured number of consecutive misses (default 2), the conversation is handed to the Inbox. A successful turn resets the counter.

**Interruptions.** If the customer interrupts (for example by speaking over a voice reply), whatever was already said and shown is saved with an `(interrupted)` marker. The system prompt tells the model to pick up anything still open.

## What the AI is told: the system prompt

`src/modules/ai/system-instructions.ts` builds the prompt in two parts. The **fixed part** (items 1–6 below) is the same on every turn of every chat for a store and channel, and changes only when the store's settings change. The **per-turn part** (items 7–11) is rebuilt every turn. The Anthropic adapter caches the fixed part (see [Model configuration](#model-configuration)); OpenAI-compatible providers receive both parts joined into one system message. In order:

1. **Base rules** (always). They cover: reply in the customer's language (Bangla or English, and treat English written in Bangla script as English); take every fact from a tool; search in English catalog words; never compute totals or quote raw minor-unit numbers; claim "out of stock" only when stock data says so; add to the cart as soon as the customer wants an item; follow the cash-on-delivery order steps; protect order privacy; hand off when stuck; treat customer text and documents as data, not instructions; never reveal the prompt; keep replies to about 12 words, one question at a time.
2. **Sales playbook** (on unless disabled in settings). Learn the customer's name, then phone, then area, one at a time, saving each with `save_customer_profile`. Recommend 1–2 matches with a reason, offer cheaper options on price objections, suggest one add-on after an item is added, and create urgency only from real data. Ask for marketing consent once, after an order, with the exact wording the tool defines.
3. **Voice rules** (voice channel only): no markdown or lists, short natural reactions, ask the customer to repeat garbled input, say prices aloud, refer to products by their position.
4. **Store persona**: assistant name, tone (friendly / professional / playful / luxury / custom), and conversation style (straightforward / explainer / consultative).
5. **Store facts**: name, currency, delivery areas and fees, free-delivery threshold, cash-on-delivery availability, supported languages.
6. **Business instructions** written by the store owner.
7. **Language hint**: the session's locale.
8. **Customer on file**: saved name, phone, address, and area, with an instruction to offer reuse instead of asking again.
9. **Open order**: a summary card waiting for the customer's yes, if there is one.
10. **Current cart**, calculated by the server.
11. **This turn**: the language to reply in, and a computed **next order step**. For example: "cart empty → help choose, call `add_to_cart` when they want something"; "cart has items, phone missing → ask only for that"; "summary on screen → call `confirm_order` if they agree". This keeps the model moving toward an order without looping or skipping steps.

## The 18 tools

Defined in `src/modules/ai/tools/` and registered in `src/modules/ai/tools/index.ts`. Each tool has a JSON schema (sent to the model) and a Zod schema (checked before execution). Invalid JSON, failed validation, unknown tools, and exceptions come back to the model as structured errors (`invalid_arguments`, `unknown_tool`, `tool_failed`); they are never shown to the customer as a crash.

| Tool | What it does |
|---|---|
| `search_products` | Searches active products by text, category, brand, attribute/variant filters, and price range; returns product cards and facets for filter chips. Bangla shopping words are mapped to English catalog terms (`ঘড়ি` → watch). A "what do you have?" query returns a browse selection with one product per category first. |
| `get_product_details` | Full details for one product. |
| `get_recommendations` | `similar`, `cheaper`, or `complementary` products, from the catalog only. Complementary items use the store's category map. |
| `search_knowledge` | Keyword search over the store's **ready** knowledge documents (policies, FAQs). |
| `get_cart` | Current cart. |
| `add_to_cart` | Adds a product or variant by ID or by name as shown. The server checks store ownership, variant, stock, and quantity limits. |
| `update_cart_item` / `remove_cart_item` | Change quantity / remove a line. |
| `prepare_checkout` | Creates a checkout link for customers who want the checkout page or online payment. |
| `save_customer_details` | Saves the details used for checkout. |
| `save_customer_profile` | Saves the name, phone, address, interests, or budget as soon as the customer gives them, and records marketing consent only on an explicit yes to the fixed consent question. |
| `collect_contact_details` | Shows an editable contact form, used once when a detail is clearly unusable. |
| `propose_order` | Shows the cash-on-delivery order summary card. Missing fields are filled from saved details; anything still missing is reported back so the model asks only for that. |
| `confirm_order` | Places the order from the summary on screen. |
| `open_product_page` / `go_to_checkout` | Navigates the customer's browser (checkout pre-filled with known details). |
| `get_order_status` | Order progress. For orders placed outside the current chat, it needs the order number **and** the phone number used for that order. |
| `request_human` | Hands the conversation to the Inbox with a one-line reason. |

### How a chat order is placed safely

1. `propose_order` creates a checkout session in the `prepared` state and shows the summary card.
2. `confirm_order` succeeds only if that card was shown **before the current customer message arrived**, so the model can't propose and place an order in the same turn.
3. Order placement re-checks the cart and prices, reserves stock in a database transaction (the last unit can't be sold twice), and is safe against double submission.
4. The model may say an order is placed only after `confirm_order` succeeds.

## Demo mode

When no usable AI connection is configured, `src/modules/ai/demo-assistant.ts` answers instead. It uses regular expressions (English and Bangla) to spot common intents: product and category searches, budgets ("under 3k", "৫০০ টাকার মধ্যে"), adding to the cart, delivery/return/payment/warranty/care questions, checkout, and order status. It calls the same catalog, cart, knowledge, and order services, so cards and totals are real. It doesn't understand free-form language, so use it to try the app's flows, not to judge assistant quality. The widget reports `aiMode: "demo"` in this state.

## Model configuration

Code: `src/modules/ai/config.ts`, `presets.ts`, `provider.ts`, `anthropic.provider.ts`; dashboard: **Admin → AI model**.

**Providers.** Anthropic (Claude), OpenAI, OpenRouter, Groq, Google Gemini (its OpenAI-compatible endpoint), Ollama (self-hosted, no key needed on localhost), or any other OpenAI-compatible endpoint. The model must support streaming tool calls.

**Where settings come from.** Settings saved in the dashboard take precedence; empty fields fall back to `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`. Dashboard keys are encrypted with `AUTH_SECRET` and shown only by their last four characters. If `AUTH_SECRET` changes, a stored key can no longer be decrypted and the dashboard says so. With no usable key, base URL, and model, the store runs in demo mode.

**Anthropic adapter.** It uses the beta Messages streaming API with `max_tokens` 64,000, thinking left at the model's default, and an **effort** level (low / medium / high / xhigh / max, default medium) chosen in the dashboard. It sends no temperature. The model's original content blocks (thinking, text, tool use) are replayed unchanged on the next loop iteration, and parallel tool results are grouped into one message. On supported models (`claude-opus-5-5`, `claude-opus-5`, `claude-fable-5-1`, `claude-sonnet-5-5`) called without a custom base URL, server-side refusal fallback is turned on. If a reply hits `max_tokens` in the middle of a tool call, the tool is not run. The SDK retries 408/409/429/5xx errors and connection failures twice. Timeout: 120 s.

**Prompt caching (Anthropic).** The system prompt is sent as two text blocks, with a `cache_control` breakpoint on the fixed one. Tools are sent before the system prompt, so the 18 tool definitions and the fixed rules form one cached prefix, reused across tool rounds, turns, and chats of the same store. Cache reads cost a fraction of normal input and shorten the wait for the first word. Changing `tool_choice` for the final round doesn't break the cache. To check it's working, look for `cache_read_input_tokens` above zero in the API usage. If it stays at zero, something per-session or per-turn has crept into the fixed part.

**OpenAI-compatible adapter.** It posts to `{baseUrl}/chat/completions` with `stream: true`, `tool_choice` (`auto`, or `none` for the final round), and temperature 0.2, and reassembles streamed tool-call fragments. Before any of the reply has streamed, it retries 408/409/429/5xx responses and dropped connections up to 2 times. It honors `Retry-After` (capped at 8 s) and otherwise waits about 0.5 s, then 1 s. The 45 s timeout covers all attempts.

**Test connection** checks the key and model without generating any tokens: it retrieves the model for Anthropic, and lists `/models` for OpenAI-compatible providers.

## Voice

Voice is turned on per store (**Configure chatbot → Chat box**) and has two engines, selected by `voiceEngine()` in `src/modules/realtime/realtime.service.ts`:

**Realtime** (`VOICE_ENGINE=realtime`, the default). It is used only when the store's AI connection is OpenAI at `api.openai.com` with a key; otherwise the widget automatically falls back to cascade.
- The server mints a 10-minute client secret (`/api/widget/voice/realtime/session`). The store's key never reaches the browser. The secret carries the full system prompt plus live-call rules ("sound like a real person", spoken Bangladeshi Bangla, a style from `REALTIME_VOICE_STYLE`) and the same 18 tool schemas.
- The browser talks to OpenAI over WebRTC, using semantic voice-activity detection with interruption, near-field noise reduction, and `gpt-4o-mini-transcribe` transcripts.
- Every tool call is sent to `/api/widget/voice/realtime/tool` and runs on the server through the same `executeTool` as text chat. When the cart or order changes, refreshed instructions (with the new next order step) are returned to the session.
- Both sides of the conversation are saved through `/api/widget/voice/realtime/transcript`, so the Inbox, the reminders, and the AI's memory see voice like text. Cards shown during a spoken reply are attached to that reply. They are held in server memory for up to 5 minutes, so on a restart the reply is saved as text only.
- The call opens with a fixed greeting and no tools. Each session is capped at `VOICE_MAX_SESSION_MINUTES` (default 15) to limit cost.

**Cascade** (`/api/widget/voice/turn`): speech-to-text → the same conversation turn as text chat (with voice rules added) → text-to-speech.
- Speech-to-text uses `SPEECH_PROVIDER` (`azure` or `openai`), or a transcript produced by the browser (`browser`, the default; recognition works in Chrome, Edge, and Safari).
- If Azure reports confidence below 0.45, the assistant asks the customer to repeat.
- A transcript that mostly repeats what the assistant just said (5+ words, 75% overlap) is treated as the speakers' echo and ignored.
- Replies are split into sentences and synthesized in parallel but delivered in order (`voice.sentence` events with MP3 audio). If no server text-to-speech is configured or it fails, the browser speaks the text itself.
- The language is detected per sentence by script, so one reply can mix Bangla and English voices.

## Human handoff and the Inbox

Code: `src/modules/conversations/handoff.service.ts`, `src/app/admin/(protected)/inbox/`.

| Mode | Meaning |
|---|---|
| `bot` | The AI replies. |
| `waiting_human` | Handed off; the AI is silent. A red badge in the dashboard counts these. |
| `human` | An agent has taken over and is replying. |
| `closed` | Finished; the customer's next message starts a new conversation. |

**A handoff starts when:**
- the customer's message matches a configured keyword;
- the model calls `request_human`; or
- the assistant misses N turns in a row (default 2).

**From the Inbox, an agent can:**
- *take over*;
- *reply* (replying also takes the conversation over);
- *hand back to the AI* (this resets the miss counter);
- *close* the conversation.

Each action posts an event message that the customer sees in the chat. The Inbox shows the customer's cart, orders, voice notes with transcripts, and photos. Agent replies are part of the model's history, so after a hand-back the AI stays consistent with what the agent said.

## Customers, analytics, and follow-up

- **Customer profiles** (`src/modules/customers/profile.service.ts`) are kept per store and visitor. They hold name, phone, address, city, delivery area, interests, preferences, order history, and marketing consent. Consent is stored with the exact question asked, the customer's reply as evidence, the channels, and a timestamp. Profiles are listed under **Admin → Customers** and can be exported as CSV (`/admin/customers/export`).
- **Events** (`src/modules/customers/events.service.ts`): `viewed_product`, `added_to_cart`, `removed_from_cart`, `checkout_started`, `order_placed`, `abandoned_cart`, `voice_turn`. They are best effort: a failure is logged and never breaks a customer action. The dashboard **Overview** shows 30-day totals: voice sessions, orders and revenue, orders and revenue from voice sessions, abandoned carts, and marketing opt-ins.
- **Abandoned carts**: `GET /api/cron/abandoned-carts` (with `Authorization: Bearer $CRON_SECRET`) flags carts with items that haven't changed for 2 hours, once per cart. It only records the event; no message is sent to the customer yet.

## Where the assistant's knowledge comes from ("training")

Nothing trains or fine-tunes the provider model on conversations or store records. The application supplies current data at runtime from four sources.

### 1. Product catalog

Products are maintained manually under **Admin → Products**, or imported from a public product API under **Configure chatbot → Product list**, with field mapping and a preview. Both write to the same `Product` / `ProductVariant` collections the storefront uses. API products are matched by their source ID; products missing from the feed are hidden, not deleted, because past orders reference them.

Auto-sync runs on the configured interval (at least 5 minutes) when it is triggered:
- in the background when a chat session starts (`/api/widget/session`);
- in the background when an admin opens **Configure chatbot**; or
- by `GET /api/cron/product-sync` with the cron secret.

An atomic lock means simultaneous triggers start only one sync. A store with no visitors only syncs when the cron endpoint is called, so schedule it in production if you need exact timing.

Search (`src/modules/catalog/product.service.ts`) gives each active product a weighted keyword score across name, category, attributes, description, and brand, then applies the filters. Unavailable products are left out of normal results. Keep names, descriptions, categories, attributes, variant options, prices, and stock accurate: the assistant can't answer about details the catalog doesn't contain.

### 2. Knowledge documents (policies and FAQs)

These are managed under **Admin → Knowledge**. Only documents with status **ready** are searchable. `search_knowledge` (`src/modules/knowledge/retrieval.service.ts`) gives each document a simple text score:
- an exact title match scores +15, or a title containing the query +8;
- content containing the whole query scores +5;
- each query word scores +4 in the title and +1 in the content.

It returns up to 3 excerpts by default (at most 5), each about 420 characters around the match. This is **keyword** retrieval, not semantic search. Use one clear topic per document and a descriptive title that uses words customers actually say. If nothing matches, the assistant is told not to invent a policy and to offer support or a handoff instead.

### 3. Assistant behavior (Configure chatbot)

- **Personality**: assistant name, tone, conversation style, welcome message, product greeting (`{product}` placeholder), suggested topics, business instructions, fallback message.
- **Sales**: sales playbook on or off; category → complementary-category map for add-on suggestions.
- **Human handoff**: on or off, trigger keywords, number of misses before handing off.
- **Chat box**: voice, attachments, color, position.

Store settings (delivery areas and fees, free-delivery threshold, cash on delivery, currency, languages) also go into the prompt.

### 4. Conversation context and saved details

The model sees a bounded recent transcript (20 messages) plus summaries of the cards on screen, not a shopper's whole history. Saved profile details are offered for reuse ("Shall I send it to Rahim, Dhanmondi?") so customers aren't asked twice. These are database records used at runtime, not training data.

## Security and data boundaries

- **The model is never the authority.** Prices, totals, stock, and order state are computed by services and the database; the model only requests actions through validated tools. The prompt tells it to treat customer text, file names, and documents as data, never as instructions.
- **Ownership checks.** Every widget request is tied to a signed session cookie. Conversations, carts, uploads, and orders are checked against the session and store, and orders outside the current chat need the order number plus phone.
- **Rate limits** (in memory, per server instance):

  | Endpoint | Limit |
  |---|---|
  | Messages and voice turns | 60/min per IP, 20/min per session |
  | Session start | 60/min per IP |
  | Cart changes | 60/min per session |
  | Checkout and order confirmation | 10/min per session |
  | Uploads | 20 per 10 min per session |
  | Realtime session | 20/min per IP, 6/min per session |
  | Admin login | 10 per 5 min per IP |

  If you run several instances, add edge or shared-store rate limiting.
- **Secrets.** AI keys stored in the dashboard are encrypted with `AUTH_SECRET`. Realtime voice uses short-lived browser tokens. Cron endpoints require `CRON_SECRET` (16+ characters), compared in constant time.
- **Third-party data flow.** When live AI or a remote speech provider is configured, the conversation context described above is sent to that provider. This includes saved customer details and the cart. Choose providers that meet the store's privacy requirements.
- **Images aren't analyzed.** Attached images and PDFs are shown to agents in the Inbox, but the model sees only a note with the file name, not the file's content.

## Configuration reference (environment)

See `.env.example` for defaults and comments. Main variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MongoDB replica-set connection string (required). |
| `AUTH_SECRET` | Signs sessions and encrypts stored AI keys (16+ characters; 32 random bytes recommended). |
| `APP_BASE_URL` | Public URL; checkout links are built from it. |
| `WIDGET_PUBLIC_KEY`, `NEXT_PUBLIC_WIDGET_KEY` | Public widget key; must match `stores.widget_key`. |
| `CRON_SECRET` | Protects `/api/cron/*`. |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Fallback AI connection when the dashboard fields are empty. |
| `VOICE_ENGINE` | `realtime` (default) or `cascade`. |
| `REALTIME_MODEL`, `REALTIME_VOICE`, `REALTIME_VOICE_STYLE`, `REALTIME_VOICE_SPEED` | Realtime voice model and how it sounds. |
| `VOICE_MAX_SESSION_MINUTES` | Hard stop for a hands-free session (default 15). |
| `SPEECH_PROVIDER`, `SPEECH_API_KEY`, `SPEECH_REGION`, `SPEECH_BASE_URL`, `SPEECH_*_MODEL`, `SPEECH_VOICE_EN/BN`, `SPEECH_RATE` | Cascade speech-to-text and text-to-speech. |
| `COMMERCE_PROVIDER`, `COMMERCE_TRUSTED_HOSTS` | Commerce adapter (`internal`) and extra allowed checkout-redirect hosts. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | First admin, used only by the seed script. |

## How to improve answer quality

1. Keep product names, descriptions, categories, attributes, variant options, prices, and stock accurate.
2. Add short, approved knowledge documents for policies and FAQs, with descriptive titles in customers' words; mark them **ready** only after review.
3. Put store-specific rules in **Business instructions**, consistent with the catalog, delivery settings, and policies.
4. Set the tone, conversation style, sales playbook, and handoff rules you want.
5. Use **Test connection**, then a real chat session. Check the cards, cart totals, and order summaries, not just the model's wording.
6. Review handed-off and missed chats in the Inbox, and fix missing or stale catalog, knowledge, or settings data. The model doesn't learn from those conversations on its own.

## Known limitations

- Payment is cash on delivery only; online payment gateways are not connected.
- Agent replies reach the widget by polling, not push.
- Rate limits and realtime card buffering are in memory, per server instance.
- Knowledge and product search are keyword-based, not semantic.
- The model can't see the content of images, PDFs, or untranscribed voice notes.
- Abandoned carts are flagged, but no reminder message is sent yet.

## Main implementation areas

| Path | Contents |
|---|---|
| `src/components/chat/` | Customer widget, chat panel, cards, voice controls (`useRealtimeVoice`, `useVoiceSession`, `useVoiceRecorder`). |
| `src/app/api/widget/` | Session, message (SSE), polling, cart, checkout, order confirm, uploads, products, and voice (greeting, turn, realtime) endpoints. |
| `src/app/api/cron/` | Product sync and abandoned-cart jobs. |
| `src/modules/ai/` | Provider adapters, presets/config, system instructions, orchestrator, demo assistant, tools. |
| `src/modules/conversations/` | Sessions, messages/history, turns, uploads, handoff, product greeting, returning-visitor reminders. |
| `src/modules/catalog/`, `cart/`, `commerce/`, `orders/` | Authoritative product, cart, checkout, and order logic. |
| `src/modules/knowledge/` | Knowledge-document retrieval. |
| `src/modules/customers/` | Profiles, consent, events/analytics, admin customer views. |
| `src/modules/speech/`, `src/modules/realtime/` | Speech providers, sentence-by-sentence voice replies, echo filter, OpenAI Realtime integration. |
| `src/app/admin/`, `src/components/dashboard/` | Dashboard pages and server actions. |
| `prisma/schema.prisma`, `prisma/seed.mjs` | Data model and demo seed (store, products, policies, admin). |
| `tests/` | Unit, integration, and Playwright end-to-end tests. |

Checks: `npm test` (Vitest unit/integration tests on an in-memory MongoDB), `npm run typecheck`, `npm run lint`, and `npm run test:e2e` (Playwright shopping journey, handoff, and dashboard flows; first run `npx playwright install chromium`).
