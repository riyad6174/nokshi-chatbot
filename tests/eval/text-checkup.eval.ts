import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { POST as createSessionRoute } from "@/app/api/widget/session/route";
import { POST as messageRoute } from "@/app/api/widget/message/route";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { prisma } from "@/lib/db/prisma";
import { getCartSummary } from "@/modules/cart/cart.service";
import { addTotals, copyStore, emptyTotals, formatTotals, post, setLanguage, type TokenTotals } from "./checkup-store";

// End-to-end checkup of the TEXT chat on the real model (Admin → AI model: Gemini), through the real
// /api/widget/message route, against an in-memory copy of the store. Every turn records the streamed
// reply, the cards, the tools the model called, the turn log (outcome, error reason) and the token
// usage the server recorded for it.
//
// Needs: EVAL_SOURCE_DATABASE_URL (store to copy, read-only), EVAL_GEMINI_API_KEY.
// Optional: EVAL_TEXT_MODEL (default gemini-3.8-flash), EVAL_REPORT_PATH. Run: npm run test:eval -- text-checkup

const SOURCE_URL = process.env.EVAL_SOURCE_DATABASE_URL?.trim();
const GEMINI_KEY = process.env.EVAL_GEMINI_API_KEY?.trim();
const TEXT_MODEL = process.env.EVAL_TEXT_MODEL?.trim() || "gemini-3.8-flash";
const REPORT_PATH = process.env.EVAL_REPORT_PATH?.trim();

type TurnLog = {
  input: string;
  status: number;
  reply: string;
  shown: string[];
  uiTypes: string[];
  tools: string[];
  toolErrors: number;
  /** Tools that failed, with their error code ("add_to_cart:variant_required"). */
  toolFailures: string[];
  streamError: string | null;
  outcome: string | null;
  errorReason: string | null;
  firstTokenMs: number | null;
  ms: number;
  tokens: TokenTotals;
};

class Chat {
  cookie = "";
  conversationId = "";
  sessionId = "";

  static async open(widgetKey: string) {
    const chat = new Chat();
    const response = await createSessionRoute(post("/api/widget/session", { widgetKey }));
    chat.cookie = response.cookies.get(WIDGET_COOKIE)!.value;
    const body = (await response.json()) as { conversationId: string; sessionId: string };
    chat.conversationId = body.conversationId;
    chat.sessionId = body.sessionId;
    return chat;
  }

  async say(text: string): Promise<TurnLog> {
    const started = Date.now();
    const since = new Date(started - 1000);
    const response = await messageRoute(post("/api/widget/message", { conversationId: this.conversationId, message: text, attachments: [] }, this.cookie));
    const log: TurnLog = {
      input: text,
      status: response.status,
      reply: "",
      shown: [],
      uiTypes: [],
      tools: [],
      toolErrors: 0,
      toolFailures: [],
      streamError: null,
      outcome: null,
      errorReason: null,
      firstTokenMs: null,
      ms: 0,
      tokens: emptyTotals(),
    };
    if (!response.ok || !response.body) {
      log.streamError = `HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`;
      return log;
    }
    // Server-sent events: "event: name\ndata: {json}\n\n".
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        const event = /^event: (.+)$/m.exec(raw)?.[1]?.trim();
        const dataLine = /^data: (.*)$/m.exec(raw)?.[1];
        if (!event || dataLine === undefined) continue;
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataLine) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event === "message.delta" && typeof data.text === "string") {
          if (log.firstTokenMs === null) log.firstTokenMs = Date.now() - started;
          log.reply += data.text;
        } else if (event === "ui.part") {
          const part = data.part as { type: string; products?: Array<{ name: string }> } | undefined;
          if (part) {
            log.uiTypes.push(part.type);
            if (part.type === "product_list") log.shown = (part.products ?? []).map((product) => product.name);
          }
        } else if (event === "message.event") {
          const message = data.message as { parts?: Array<{ type: string }> } | undefined;
          for (const part of message?.parts ?? []) if (part.type !== "text") log.uiTypes.push(part.type);
        } else if (event === "message.error") {
          log.streamError = String(data.message ?? "error");
        }
      }
    }
    log.ms = Date.now() - started;
    const turn = await prisma.aiTurnLog.findFirst({ where: { conversationId: this.conversationId, at: { gte: since } }, orderBy: { at: "desc" } });
    if (turn) {
      log.outcome = turn.outcome;
      log.errorReason = turn.errorReason ?? null;
      log.tools = (turn.toolCalls ?? []).map((call) => call.name);
      log.toolErrors = turn.toolErrorCount;
      log.toolFailures = (turn.toolCalls ?? []).filter((call) => !call.ok).map((call) => `${call.name}:${call.code}`);
    }
    const usage = await prisma.aiUsageEvent.findMany({ where: { conversationId: this.conversationId, at: { gte: since } } });
    for (const row of usage) {
      addTotals(log.tokens, {
        input: row.inputTokens,
        cached: row.cachedInputTokens,
        output: row.outputTokens,
        reasoning: row.reasoningTokens,
        requests: 1,
      });
    }
    return log;
  }

  cart(storeId: string) {
    return getCartSummary(this.sessionId, storeId, "BDT");
  }
}

type Check = { scenario: string; check: string; pass: boolean; detail: string };
const checks: Check[] = [];
const transcripts: Array<{ scenario: string; turns: TurnLog[] }> = [];
const BANGLA = /[ঀ-৿]/;
const isBangla = (text: string) => {
  const letters = text.replace(/[^A-Za-zঀ-৿]/g, "");
  return letters.length > 0 && (letters.match(/[ঀ-৿]/g)?.length ?? 0) / letters.length > 0.5;
};
const short = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max)}…` : text);
const record = (scenario: string, check: string, pass: boolean, detail = "") => checks.push({ scenario, check, pass, detail });

describe.skipIf(!SOURCE_URL || !GEMINI_KEY)("Text chat checkup (Gemini)", () => {
  it("answers, shows exact products, handles cart and orders", { timeout: 1_800_000 }, async () => {
    const store = await copyStore(SOURCE_URL!, GEMINI_KEY!);
    await prisma.chatbotSettings.update({ where: { storeId: store.id }, data: { model: TEXT_MODEL, aiEffort: "low" } });
    const products = await prisma.product.findMany({ where: { status: "active" } });
    const categoryOf = new Map(products.map((product) => [product.name, product.category]));
    const priceOf = new Map(products.map((product) => [product.name, product.priceMinor]));

    const scenario = async (name: string, run: (chat: Chat, turns: TurnLog[]) => Promise<void>) => {
      const turns: TurnLog[] = [];
      transcripts.push({ scenario: name, turns });
      try {
        const chat = await Chat.open(store.widgetKey);
        const say = async (text: string) => {
          const turn = await chat.say(text);
          turns.push(turn);
          // Every request must come back cleanly: HTTP 200, no stream error, turn not "error".
          if (turn.status !== 200 || turn.streamError || turn.outcome === "error") {
            record(name, `request ok: "${short(text, 40)}"`, false, `HTTP ${turn.status} · ${turn.streamError ?? ""} · outcome ${turn.outcome} · ${turn.errorReason ?? ""}`);
          }
          return turn;
        };
        await run(Object.assign(chat, { sayTurn: say }), turns);
      } catch (error) {
        record(name, "scenario ran", false, error instanceof Error ? error.message : String(error));
      }
    };
    type WithSay = Chat & { sayTurn: (text: string) => Promise<TurnLog> };

    await setLanguage("auto");

    await scenario("Browse all products", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("আপনাদের কি কি প্রোডাক্ট আছে?");
      record("Browse all products", "calls search_products", turn.tools.includes("search_products"), turn.tools.join(", "));
      record("Browse all products", "shows the range (≥10 cards)", turn.shown.length >= 10, `${turn.shown.length} shown`);
      record("Browse all products", "replies in Bangla", isBangla(turn.reply), short(turn.reply));
    });

    await scenario("Show bags", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("ব্যাগ দেখান");
      const bags = products.filter((product) => product.category === "Bags").map((product) => product.name);
      record("Show bags", "shows every bag and only bags", bags.every((bag) => turn.shown.includes(bag)) && turn.shown.every((name) => categoryOf.get(name) === "Bags"), `shown: ${turn.shown.join(", ") || "none"}`);
    });

    await scenario("English question", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("Show me wireless earbuds");
      record("English question", "shows Wireless Earbuds Pro first", turn.shown[0] === "Wireless Earbuds Pro", `shown: ${turn.shown.join(", ") || "none"}`);
      record("English question", "replies in English", turn.reply.length > 0 && !BANGLA.test(turn.reply), short(turn.reply));
    });

    await scenario("Colour filter", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("লাল রঙের স্কার্ফ আছে?");
      record("Colour filter", "shows Handloom Scarf", turn.shown.includes("Handloom Scarf"), `shown: ${turn.shown.join(", ") || "none"}`);
    });

    await scenario("Budget filter", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("তিন হাজার টাকার নিচে কি কি ইলেকট্রনিক্স আছে?");
      const wrong = turn.shown.filter((name) => (priceOf.get(name) ?? 0) > 300_000 || categoryOf.get(name) !== "Electronics");
      record("Budget filter", "only electronics under 3,000", turn.shown.includes("Power Bank 20000mAh") && wrong.length === 0, `shown: ${turn.shown.join(", ") || "none"}`);
    });

    await scenario("Cart: add, change, remove", async (chat) => {
      const c = chat as WithSay;
      await c.sayTurn("ব্যাকপ্যাক দেখান");
      await c.sayTurn("অলিভ কালারটা কার্টে দিন");
      let cart = await chat.cart(store.id);
      record("Cart: add, change, remove", "adds the Olive backpack", cart.items.some((item) => item.name === "Urban Trek Backpack" && item.variantTitle === "Olive" && item.quantity === 1), cart.items.map((item) => `${item.name} (${item.variantTitle}) x${item.quantity}`).join(", ") || "empty");
      await c.sayTurn("ওটা দুইটা করে দিন");
      cart = await chat.cart(store.id);
      record("Cart: add, change, remove", "quantity 2", cart.items.find((item) => item.name === "Urban Trek Backpack")?.quantity === 2, cart.items.map((item) => `${item.name} x${item.quantity}`).join(", ") || "empty");
      await c.sayTurn("না থাক, ব্যাকপ্যাকটা কার্ট থেকে বাদ দিন");
      cart = await chat.cart(store.id);
      record("Cart: add, change, remove", "removes it", !cart.items.some((item) => item.name === "Urban Trek Backpack"), cart.items.map((item) => item.name).join(", ") || "empty");
    });

    await scenario("Sold-out version", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("কালো লেদার বেল্টের ঘড়িটা কার্টে দিন");
      const cart = await chat.cart(store.id);
      record("Sold-out version", "doesn't add the sold-out version, says so", !cart.items.some((item) => item.variantTitle === "Black / Black leather") && turn.reply.length > 0, short(turn.reply));
    });

    await scenario("Pick by number", async (chat) => {
      const c = chat as WithSay;
      const browse = await c.sayTurn("সব প্রোডাক্ট দেখান");
      const third = browse.shown[2];
      const pick = await c.sayTurn("তিন নম্বরটা কার্টে দিন");
      const cart = await chat.cart(store.id);
      const variants = products.find((product) => product.name === third) ? (await prisma.productVariant.count({ where: { product: { name: third! }, stockStatus: { not: "out_of_stock" } } })) : 0;
      const added = cart.items.some((item) => item.name === third);
      record("Pick by number", "acts on the 3rd product", Boolean(third) && (added || (variants > 1 && pick.reply.length > 0)), `3rd: ${third} (${variants} versions) · cart: ${cart.items.map((item) => item.name).join(", ") || "empty"} · ${short(pick.reply)}`);
    });

    await scenario("Not sold here", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("আপনাদের কাছে ল্যাপটপ আছে?");
      record("Not sold here", "says laptops aren't sold", /নেই|পাওয়া যায় না|don't|not available/i.test(turn.reply), short(turn.reply));
    });

    await scenario("Store question", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("ঢাকার ভেতরে ডেলিভারি চার্জ কত?");
      record("Store question", "answers with a charge", /\d|টাকা|শো|আশি|ষাট/.test(turn.reply), `${turn.tools.join(", ") || "no tool"} · ${short(turn.reply, 200)}`);
    });

    await scenario("Compare products", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("ইয়ারবাডস আর ফিটনেস ব্যান্ডের মধ্যে পার্থক্য কি?");
      record("Compare products", "uses the product tools (not policy search)", turn.tools.some((name) => ["compare_products", "get_product_details", "search_products"].includes(name)) && !turn.tools.includes("search_knowledge"), `${turn.tools.join(", ")} · ${short(turn.reply)}`);
    });

    await scenario("Details, then the page", async (chat) => {
      const c = chat as WithSay;
      const details = await c.sayTurn("ব্যাকপ্যাকের details বলেন");
      record("Details, then the page", "details: card, no page jump", details.shown.includes("Urban Trek Backpack") && !details.uiTypes.includes("navigate"), `${details.tools.join(", ")} · ${short(details.reply)}`);
      const page = await c.sayTurn("পেজটা খুলে দিন");
      record("Details, then the page", "opens the page", page.uiTypes.includes("navigate"), `${page.tools.join(", ")}`);
    });

    await scenario("Full order, then something else", async (chat, turns) => {
      const c = chat as WithSay;
      await c.sayTurn("আমি একটা কটন কুর্তি মিডিয়াম সাইজ অর্ডার করতে চাই");
      const cart = await chat.cart(store.id);
      record("Full order, then something else", "adds Cotton Kurti (Medium)", cart.items.some((item) => item.name === "Cotton Kurti" && item.variantTitle === "Medium"), cart.items.map((item) => `${item.name} (${item.variantTitle})`).join(", ") || "empty");
      await c.sayTurn("আমার নাম রাকিব হাসান, ফোন 01712345678, ঠিকানা বাড়ি ১২, রোড ৫, ধানমন্ডি, ঢাকা");
      let order = null;
      for (const text of ["হ্যাঁ, অর্ডার কনফার্ম করেন", "হ্যাঁ কনফার্ম", "হ্যাঁ"]) {
        await c.sayTurn(text);
        order = await prisma.order.findFirst({ where: { sessionId: chat.sessionId } });
        if (order) break;
      }
      record("Full order, then something else", "places the order with the right item and customer", Boolean(order && order.items.some((item) => item.name === "Cotton Kurti") && order.customer.phone.endsWith("1712345678")), order ? `${order.orderNumber} · ${order.customer.name} · ${order.customer.phone}` : `no order · last reply: ${short(turns.at(-1)?.reply ?? "")}`);
      const after = await c.sayTurn("আর কি কি জামা আছে?");
      record("Full order, then something else", "a new question doesn't bring the order card back", !after.uiTypes.includes("order_status") && !after.tools.includes("get_order_status"), `${after.tools.join(", ")} · cards: ${after.uiTypes.join(", ") || "none"}`);
    });

    await setLanguage("bn");
    await scenario("Language fixed to Bangla", async (chat) => {
      const turn = await (chat as WithSay).sayTurn("Do you have any backpacks?");
      record("Language fixed to Bangla", "English question → Bangla reply", isBangla(turn.reply), short(turn.reply));
    });
    await setLanguage("auto");

    await scenario("Ask for the team", async (chat) => {
      await (chat as WithSay).sayTurn("আমি তোমার টিমের সাথে সরাসরি কথা বলতে চাই");
      const conversation = await prisma.conversation.findUnique({ where: { id: chat.conversationId } });
      record("Ask for the team", "hands off to a person", conversation?.status === "waiting_human", `status: ${conversation?.status}`);
    });

    // --- report ----------------------------------------------------------------------------------
    const allTurns = transcripts.flatMap((entry) => entry.turns);
    const total = emptyTotals();
    for (const turn of allTurns) addTotals(total, turn.tokens);
    const first = allTurns.map((turn) => turn.firstTokenMs).filter((ms): ms is number => ms !== null).sort((a, b) => a - b);
    const full = allTurns.map((turn) => turn.ms).sort((a, b) => a - b);
    const pct = (list: number[], p: number) => (list.length ? list[Math.min(list.length - 1, Math.floor(list.length * p))] : null);
    const failedRequests = allTurns.filter((turn) => turn.status !== 200 || turn.streamError || turn.outcome === "error");
    const perTurn = allTurns.length ? Math.round((total.input + total.cached + total.output) / allTurns.length) : 0;
    const passed = checks.filter((check) => check.pass).length;
    const lines = [
      `TEXT CHECKUP (${TEXT_MODEL}): ${passed}/${checks.length} checks passed`,
      `requests: ${allTurns.length} turns, ${failedRequests.length} failed`,
      `first words: median ${pct(first, 0.5)} ms, p90 ${pct(first, 0.9)} ms · full reply: median ${pct(full, 0.5)} ms, p90 ${pct(full, 0.9)} ms`,
      `tokens: ${formatTotals(total)} · about ${perTurn.toLocaleString("en-US")} per turn`,
      "",
      ...checks.map((check) => `${check.pass ? "PASS" : "FAIL"}  ${check.scenario} › ${check.check}${check.detail ? `  —  ${check.detail}` : ""}`),
    ];
    console.log(lines.join("\n"));
    if (REPORT_PATH) writeFileSync(REPORT_PATH, JSON.stringify({ summary: lines, checks, transcripts }, null, 2));
  });
});
