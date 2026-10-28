# Nokshi Shopping Assistant

A Next.js store with a built-in AI shopping assistant. The assistant recommends real products, narrows choices
with tappable filters, manages the cart, collects delivery details in the chat, and hands off to checkout.
Customers can ask for order status at any time. When the assistant can't help, it hands the chat to your team, who
take over from a live Inbox. Customers can type, send voice notes, or attach photos.

## Quick start

```bash
npm install
cp .env.example .env              # set DATABASE_URL (MongoDB Atlas) and AUTH_SECRET
npm run db:push                   # create collections + indexes
npm run db:seed                   # demo store, products, policies, admin user
npm run dev                       # http://localhost:3000 · dashboard: /admin
```

**No Atlas yet?** `npm run db:local` starts a local MongoDB replica set (no install needed; data in `.mongo-data/`).
Then set `DATABASE_URL="mongodb://127.0.0.1:27017/nokshi?replicaSet=rs0"`. A replica set is required because
orders use transactions, and Atlas clusters already are one.

Until an AI model is connected, a **demo assistant** answers from the same catalog, cart and order tools.

## Dashboard

| Page | What it does |
|---|---|
| **Inbox** | Chats handed to a person (red badge = waiting), plus all conversations. Take over, reply, hand back to the AI, or close. Updates live. Shows the customer's cart, orders, voice notes (with transcript) and photos. |
| **Orders** | Every order, with filters. Change status (placed → confirmed → processing → shipped → delivered; cancel or refund) and add a tracking number or a note. The customer sees each change in their chat. Cancelling puts the stock back. |
| **Products** | The product list the store and the assistant share. |
| **Configure chatbot** | **Product list:** manual, or *auto entry* from a public product API, with field mapping, preview, and auto-sync every 15 min to daily. **Personality:** name, tone, conversation type (straightforward / explainer / consultative), greetings, topic badges, business instructions. **Human handoff:** trigger words and how many misses before handing off. **Chat box:** voice, attachments, colour, position. |
| **Knowledge** | Policies and FAQs the assistant quotes (delivery, refunds, warranty…). |
| **AI model** | Anthropic (Claude) via the official SDK, or any OpenAI-compatible provider. Keys are encrypted. *Test connection* checks without spending tokens. |
| **Store settings** | Store details, delivery areas and fees, free-delivery threshold, cash on delivery. |

### Product auto entry
Products from the API are written into the **same** product collection the store uses (matched by the API's ID),
so nothing is stored twice. Each sync updates names, prices and stock. Products missing from the feed are hidden,
not deleted, because past orders reference them. Syncs run when the site gets traffic. For exact timing in
production, call `GET /api/cron/product-sync` with `Authorization: Bearer $CRON_SECRET` from a scheduler.

## How a chat flows

1. **Greeting.** On the home page: the welcome message plus topic badges. On a product page: a greeting plus a
   factual overview of that product, built from the catalog with no AI call, so it appears instantly.
2. **Discovery.** Product cards with variants and *Add* buttons. Chips such as color, brand and material narrow
   the results.
3. **Cart.** Add, change quantity or remove, by chat or by buttons. Totals are always computed on the server.
4. **Ordering.** The chat asks for name, phone and address, then opens the checkout page pre-filled. The customer
   picks a delivery area and payment and places the order. Stock is reserved atomically, and prices are re-checked
   against what the customer saw.
5. **Status.** "Where's my order?" shows a progress card. Orders from other chats need the order number *and* phone.
6. **Handoff.** Trigger words, repeated misses, or the AI's own judgment move the chat to the Inbox. The AI stays
   quiet until an agent hands it back.

## Tests

| Command | Covers |
|---|---|
| `npm test` | 91 unit/integration tests on a throwaway in-memory MongoDB: catalog scoping, cart rules, checkout and order placement (including the last-unit race, price changes, double submit), status transitions and stock release, order privacy, handoff rules and takeover, product-page greeting, API sync (create/update/hide/lock/failure), uploads ownership, AI tool loop, key encryption, HTTP routes |
| `npm run test:e2e` | Playwright, desktop and mobile: chat → refine → cart → details in chat → checkout → order → status in chat; topic badges; product-page greeting; human handoff with an agent replying from the Inbox; dashboard pages |

Neither touches your real database. First E2E run: `npx playwright install chromium`.

## Deploying

1. **MongoDB Atlas:** create a cluster, allow your host's IPs, set `DATABASE_URL`, then run `npm run db:push`.
2. **Secrets** go in the host's secret manager: `AUTH_SECRET` (32+ random bytes, which also encrypts stored AI
   keys), `CRON_SECRET`, and optionally `AI_API_KEY` (or set the key in the dashboard).
3. `APP_BASE_URL` = your public HTTPS URL (checkout links are built from it).
4. Seed once with real `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then change the password.
5. Rate limits are in-memory per instance. For multiple instances, use edge rate limiting or a shared store.

## Not built yet / next

- **Online payment** (bKash, SSLCommerz, card): checkout offers cash on delivery until a gateway is connected.
- **Order notifications by SMS/WhatsApp**, abandoned-cart reminders, back-in-stock alerts, chat ratings,
  an analytics funnel (chats → carts → orders), and multiple admin roles.
- Real-time push (WebSockets/SSE) instead of polling for agent replies.
- Voice transcription depends on the browser (Chrome, Edge, Safari). In other browsers, voice notes go to
  the team without a transcript.
