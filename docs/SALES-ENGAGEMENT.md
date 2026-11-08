# AI Sales & Engagement: how it works and how to run it

This covers what was added on top of the assistant described in [AI-CHATBOT-GUIDE.md](AI-CHATBOT-GUIDE.md): the sales engine and industry presets, proactive engagement, better recommendations and search, image and PDF understanding, marketing automation, analytics, and the production-reliability changes. Paths are relative to the repository root.

## Design rules

- **The application owns every fact.** Products, prices, stock, compatibility, recipes and reasons come from the catalog and the store's saved configuration. The model chooses and explains, the server validates, and every write still goes through the existing services.
- **Industry behaviour is data, not code.** Presets are starting values in `src/modules/sales/presets.ts`. A store's configuration (`ChatbotSettings.salesConfig`) is merged over its preset and validated with Zod in `src/modules/sales/config.ts`. The core chatbot has no `if (industry === …)` branches.
- **Backward compatible.** A store with no saved configuration uses the `general` preset: the same prompt as before plus a short sales section, with proactive engagement **off**. The old "complementary categories" map still works and is merged in as relationships.

## Sales engine

| Piece | File |
|---|---|
| Config schema, industries, merge and validation | `src/modules/sales/config.ts` |
| Presets: general, grocery, fashion, electronics, beauty, home, sports | `src/modules/sales/presets.ts` |
| Prompt sections (cached part and per-turn part) | `src/modules/sales/prompt.ts` |
| Shopping-intent signals (English, Bangla, Banglish) | `src/modules/sales/intent.ts` |
| Per-visit state: suggestions shown or dismissed, opt-out, limits | `src/modules/sales/state.ts` (stored in `ChatSession.engagement`) |
| Loose term matching (plural and spelling tolerant) | `src/modules/sales/matching.ts` |

On each turn the **stable** prompt gains the store's role, personality, conversation rules, recommendation limits, checkout guidance and handoff rules. These depend only on saved settings, so the Anthropic prompt cache still works. The **per-turn** prompt gains:

- a shopping signal (browsing, interested, comparing, undecided, price-sensitive, ready to buy, or support), with what to do next;
- products already suggested this visit, so they aren't repeated;
- whether the customer opted out or the add-on limit was reached;
- returning-customer context (earlier orders and interests);
- a high-value-cart handoff hint;
- a deterministic summary of messages older than the 20-message window.

"Stop suggesting things" (or the Bangla and Banglish equivalents) sets an opt-out on the session and on the customer profile. Asking for suggestions again clears it.

### Recommendations (`src/modules/catalog/recommendation.service.ts`)

`get_recommendations` kinds:

| Kind | What it returns |
|---|---|
| `similar` | Alternatives or substitutes |
| `cheaper` | Lower-priced alternatives |
| `complementary` | Add-ons |
| `complete_the_look` | Matching items, with colour pairing |
| `compatible` | Accessories that fit the product: they must match its compatibility attributes, or state none |
| `recipe` | The other ingredients for a dish |
| `bundle` | A complete set for a need |
| `personalized` | Picks based on the customer's interests |

Candidates are always the store's active, available products within the budget (`maxPriceMinor`). Ranking combines configured relationships, colour pairings, compatibility attributes, attribute and keyword overlap, and embeddings when present. Each result carries a `reason` built from catalog data. The store's strategy (balanced, budget first, premium first, …) breaks ties.

Unrequested add-ons count toward `maxAddOnsPerConversation` and stop after an opt-out. When the customer explicitly asks, the model passes `customerAsked: true` and the limit doesn't apply. The new `compare_products` tool shows a comparison card built from catalog facts only.

## Admin → AI Sales & Engagement (`/admin/sales`)

- **Industry preset**: replaces the configuration with a preset (asks for confirmation).
- **Role**: business type, "acts as", personality, conversation rules.
- **Recommendations**:
  - strategy, products per suggestion, and unrequested add-ons per chat;
  - relationships, one per line: `Shirts -> Pants, Chinos | complete_the_look | {to} to complete the look`;
  - recipes: `potato curry: potato, onion, green chili`;
  - colour pairings: `white: beige, navy`;
  - compatibility attributes and search synonyms.
- **Proactive engagement**: per-trigger switches and delays, visit limit, minimum spacing, quiet during checkout, closed-chat nudge, and message templates (`{product}`, `{suggestions}`, `{recipe}`).
- **Sales goals and handoff**: checkout guidance, add-ons, free-delivery nudge, offering a person for high-value carts or undecided shoppers.
- **AI features**: image/PDF understanding and semantic search switches.
- **Test recommendations**: preview what the assistant would suggest for a product.

Configuration is stored per store (`ChatbotSettings.salesConfig`). The dashboard, like the rest of the admin, manages the primary store.

## Proactive engagement

`POST /api/widget/engagement` (`src/modules/sales/engagement.service.ts`) receives shopper activity:

- `product_view {productId, dwellSeconds}`
- `search {query}`
- `compare {productIds}`
- `add_to_cart {productId}`
- `cart_idle`
- `checkout_start`
- feedback: `dismiss`, `suggestion_click`, `opt_out`, `opt_in`

The server shows a message only when all of these hold:

1. the store has the engine and the trigger on;
2. a human isn't handling the chat;
3. the visitor hasn't opted out;
4. the shopper isn't checking out (when suppression is on);
5. the visit limit and minimum spacing allow it;
6. this trigger and product haven't been used already;
7. the dwell or idle time has really passed (idle time comes from the cart's `updatedAt` on the server);
8. a strong match exists: a configured relationship, recipe, colour pairing or verified compatibility. Generic filler never counts.

No model is called, so the message is instant and can't invent anything. It is saved in the conversation with **No thanks** and **Stop suggestions** buttons, and the AI's history marks it as proactive.

The widget reports its own product views, cart adds, idle carts and checkout starts. Host sites can report theirs:

```js
window.dispatchEvent(new CustomEvent("nokshi:activity", { detail: { type: "add_to_cart", productId: "<id>" } }));
// also: { type: "search", query }, { type: "compare", productIds: [...] }, { type: "product_view", productId }, { type: "checkout_start" }
```

The widget doesn't report activity while a reply is streaming or within 60 s of the customer chatting. When the chat is closed, a small nudge appears by the launcher.

## Search and knowledge

- **Bangla, Banglish and synonyms** (`src/modules/catalog/query-terms.ts`): groceries, fashion and electronics terms in both scripts ("আলু" and "aloo" → potato, "juta" → shoes, "sneakers" → shoes), plus each store's own synonyms.
- **Knowledge retrieval** (`src/modules/knowledge/retrieval.service.ts`): word stems, policy synonyms ("money back" → return/refund), Bangla terms, and the best-matching paragraph as the excerpt. Unanswered lookups are logged, and Analytics lists them as missing information.
- **Semantic search** (`src/modules/search/embeddings.service.ts`): optional and off by default.
  - Vectors are stored on `Product.embedding` and `KnowledgeDocument.embedding` and refreshed by the `embeddings.refresh` job, only when the text changed.
  - Keyword search always runs first. Embeddings are queried only when it finds fewer than 3 products, and the two scores are combined.
  - If the embeddings API is down, search falls back to keywords.

### Infrastructure and cost

There is no new database and no new npm dependency.

- **`VECTOR_SEARCH=local`**: similarity is computed in the app. It's fine up to a few thousand products per store.
- **`VECTOR_SEARCH=atlas`**: uses MongoDB Atlas Vector Search. It needs an Atlas cluster tier that supports vector indexes, and one index per collection, for example on `Product`:
  ```json
  { "fields": [
      { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
      { "type": "filter", "path": "storeId" }, { "type": "filter", "path": "status" } ] }
  ```
  Create the same index on `KnowledgeDocument`. Set `numDimensions` to your model's size (`text-embedding-3-small` = 1536, or the `EMBEDDINGS_DIMENSIONS` you choose).
- **Embedding cost**: one call per changed product or document, plus one per search that keyword matching can't answer. With `text-embedding-3-small` that is a few cents per 10,000 calls. Product and knowledge text, and those customer search queries, are sent to the embeddings provider.

## Image and document understanding (`src/modules/ai/attachments.ts`)

Images (JPEG/PNG/WebP/GIF) and PDFs attached to the **current** message are passed to the model. The loader:

- reads only uploads belonging to this store and conversation;
- sends at most 3 files, 5 MB per image and 12 MB in total;
- checks each file's signature bytes against its declared type;
- frames the files as customer data whose instructions must be ignored.

PDFs go to the model only with Claude or OpenAI's own API; with other providers they are skipped with a note. If a model rejects image input (HTTP 400/413/415/422), the turn is retried as text and the assistant asks the customer to describe the file.

Turn it off per store (AI features) or everywhere with `AI_ATTACHMENT_UNDERSTANDING=off`. Attached files are sent to the AI provider.

## Marketing automation (`src/modules/marketing/`, Admin → Marketing)

- **Consent** (`consent.ts`): a message requires an explicit yes for that channel (the existing consent record), a contact detail for the channel, and no unsubscribe. Consent is checked when a message is queued **and again when it is sent**.
- **Unsubscribe**: every message carries a signed link `/api/marketing/unsubscribe?token=…`. GET shows a confirmation page (so link scanners don't unsubscribe anyone); POST unsubscribes, including RFC 8058 one-click from mail clients. Unsubscribing withdraws consent and skips anything still queued.
- **Campaigns** (`campaign.service.ts`):
  - **Abandoned-cart reminders** (an automation): carts idle for 2 h are flagged, and a reminder is sent after the campaign's delay. It's skipped if the cart was bought or emptied in the meantime.
  - **Product follow-ups and broadcasts**: one-off sends to a segment. Segments can filter by orders, spend, recency, interests, and categories browsed in the last 30 days.
  - Placeholders: `{name}`, `{store}`, `{cart}`, `{products}` (real recommendations), `{link}` (click-tracked, store-relative only).
  - Each campaign, customer and occasion is sent at most once.
- **Delivery** (`channels.ts`), set by `MARKETING_PROVIDER`:
  - `log`: dry run, the default;
  - `webhook`: a signed JSON POST to any SMS, WhatsApp or email gateway;
  - `resend`: email through Resend.
- **Separation**: order notifications (chat events, order status) never go through the marketing module.

## Analytics (Admin → Analytics, `src/modules/analytics/`)

Reports cover 7, 30 or 90 days, per store:

- **Sales**: orders, revenue, average order value.
- **Conversion**: search → purchase, cart → checkout → order, abandoned-cart recovery (and recovery after a reminder).
- **Recommendations**: shown, clicked, added to cart, purchased. Cart additions are attributed to earlier suggestions in the same visit.
- **Proactive engagement**: messages shown, dismissed, and opt-outs.
- **AI**: answer rate, handoff rate, tool error rate and the most common tool errors, p50/p95 latency, time to first word. These come from `AiTurnLog`, one row per turn.
- **Human agents**: handoffs, median first response, resolutions, replies per agent.
- **Content gaps**: frequent searches, searches with no matching product, unanswered policy questions, unanswered customer questions.

## Reliability and security changes

- **Shared rate limiting** (`src/lib/rate-limit.ts`): an atomic MongoDB counter per window with a TTL index. It's the default in production (`RATE_LIMIT_BACKEND=mongo`) and fails open to memory if the database has a problem.
- **Durable jobs** (`src/modules/jobs/`):
  - stored in the `Job` collection, enqueued once per `(type, dedupeKey)`;
  - claimed atomically, so several instances never run the same job;
  - retried with exponential backoff up to `maxAttempts`, then marked failed;
  - picked up again when a worker dies, once its lock expires;
  - run by `GET /api/cron/jobs`.
- **Order concurrency** (`src/modules/orders/order.service.ts`): the checkout is claimed conditionally inside the order transaction. Of simultaneous submits (double tap, two tabs, a retry), exactly one places the order and the others get the same order back; stock is reserved once. MongoDB write conflicts are retried. The earlier safeguards still apply: confirming requires a summary shown in an earlier turn, prices are re-checked, and stock decrements are conditional.
- **AI tool calls** still go through Zod validation and store-scoped services. Tests cover a model trying to propose and confirm in one turn, and smuggling another store's ids.
- **Agent messaging**: during a handoff the widget uses a server-sent event stream (`/api/widget/messages/stream`). The server checks MongoDB every second, so it works across instances, and the widget falls back to polling.
- **Monitoring**: `GET /api/health` adds job backlog, failed jobs and the AI error rate, with `alerts`. Logs remain structured JSON with secrets redacted.

## Database changes (`prisma db push`, additive only)

- **New fields** (all optional or defaulted):
  - `ChatbotSettings.salesConfig`
  - `ChatSession.engagement`
  - `CustomerProfile.unsubscribedAt` and `proactiveOptOut`
  - `Product.embedding/embeddingHash` and `KnowledgeDocument.embedding/embeddingHash`
- **New models**: `Job`, `AiTurnLog` (with the `AiToolCallLog` type), `MarketingCampaign`, `MarketingMessage`.
- **Raw collection**: `rate_limit_buckets` (with a TTL index created on first use).

Existing documents need no migration.

## Deployment

1. Set the environment variables (see `.env.example`):
   - `RATE_LIMIT_BACKEND=mongo` (the production default);
   - optionally `EMBEDDINGS_*` and `VECTOR_SEARCH`;
   - `MARKETING_*`;
   - `AI_ATTACHMENT_UNDERSTANDING`.
2. Run `npm run db:push` against the production database.
3. Schedule, with `Authorization: Bearer $CRON_SECRET`:
   - `GET /api/cron/jobs` every minute;
   - `GET /api/cron/abandoned-carts` hourly;
   - `GET /api/cron/product-sync` as before.
4. For Atlas vector search: create the two vector indexes above, then set `VECTOR_SEARCH=atlas`.
5. In Admin → AI Sales & Engagement, apply your industry preset, adjust it, and use **Test recommendations**. Turn on proactive engagement when you're happy with the suggestions.
6. To send real marketing messages, set `MARKETING_PROVIDER` and create campaigns in Admin → Marketing. Until then, messages are only logged.

## Remaining limitations

- **Proactive messages are templates.** They are rule-based rather than written by the model, which keeps them instant and factual but less varied.
- **Realtime voice** (OpenAI Realtime) gets the industry persona and rules but not the per-turn sales signal or attachments. The cascade voice pipeline gets everything.
- **Local vector search** scans every embedded product of a store per query. Use Atlas above a few thousand products.
- **Marketing has no built-in SMS or WhatsApp provider.** Connect one through the webhook. There's no visual email editor and no A/B testing.
- **Single-store admin.** Analytics and configuration are per store, but the admin dashboard manages the primary store, as before.
- **Intent signals are keyword heuristics.** They guide the model; they don't decide anything.
