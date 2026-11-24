import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { POST as createSessionRoute } from "@/app/api/widget/session/route";
import { POST as geminiSessionRoute } from "@/app/api/widget/voice/gemini/session/route";
import { POST as toolRoute } from "@/app/api/widget/voice/realtime/tool/route";
import { POST as transcriptRoute } from "@/app/api/widget/voice/realtime/transcript/route";
import { WIDGET_COOKIE } from "@/lib/auth/widget";
import { prisma } from "@/lib/db/prisma";
import { getCartSummary } from "@/modules/cart/cart.service";
import { normalizeGeminiUsage } from "@/modules/realtime/gemini-live.service";
import { addTotals, copyStore as copyStoreFrom, emptyTotals, formatTotals, post, setLanguage, type TokenTotals } from "./checkup-store";


// End-to-end checkup of the Gemini Live voice assistant: the real Gemini Live model, the real
// session/tool/transcript routes, run against an in-memory COPY of the store (catalog, knowledge,
// settings), so test carts and orders never touch real data. Typed turns test decisions (right tool,
// exact products, cart changes, orders); spoken turns (Gemini text-to-speech streamed as microphone
// audio) test listening.
//
// Needs: EVAL_SOURCE_DATABASE_URL (the store to copy, read-only), EVAL_GEMINI_API_KEY.
// Optional: EVAL_REPORT_PATH (JSON transcript), EVAL_TTS_MODEL. Run: npm run test:eval -- voice-checkup

const SOURCE_URL = process.env.EVAL_SOURCE_DATABASE_URL?.trim();
const GEMINI_KEY = process.env.EVAL_GEMINI_API_KEY?.trim();
const TTS_MODEL = process.env.EVAL_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
const REPORT_PATH = process.env.EVAL_REPORT_PATH?.trim();

const copyStore = () => copyStoreFrom(SOURCE_URL!, GEMINI_KEY!);

// --- store copy ----------------------------------------------------------------------------------


// --- speech --------------------------------------------------------------------------------------

/** Customer speech: Gemini text-to-speech (24 kHz PCM), resampled to the 16 kHz the call takes. */
async function speak(text: string, voice = "Puck"): Promise<Int16Array> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_KEY!, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>; error?: { message?: string } };
  const data = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
  if (!data) throw new Error(`TTS failed: ${body.error?.message ?? response.status}`);
  const bytes = Buffer.from(data, "base64");
  const input = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
  const ratio = 24_000 / 16_000;
  const output = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    output[i] = Math.round(input[left]! + (input[right]! - input[left]!) * (position - left));
  }
  return output;
}

// --- a live call ---------------------------------------------------------------------------------

type ToolLog = { name: string; args: Record<string, unknown>; ok: boolean; shown: string[]; uiTypes: string[]; url?: string; ms: number };
type TurnLog = {
  input: string;
  mode: "text" | "audio";
  heard: string;
  reply: string;
  tools: ToolLog[];
  shown: string[];
  firstAudioMs: number | null;
  /** How long the spoken reply is (all audio received for this turn). */
  audioMs: number;
  /** Tokens Gemini reported for this turn (usageMetadata). */
  tokens: TokenTotals;
  doneMs: number;
  timedOut: boolean;
};
type ServerMessage = {
  usageMetadata?: Record<string, unknown>;
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: Array<{ thought?: boolean; inlineData?: { data?: string } }> };
    turnComplete?: boolean;
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> };
};

class Call {
  private ws!: WebSocket;
  private listener: ((message: ServerMessage) => void) | null = null;
  cookie = "";
  sessionId = "";
  greeting: TurnLog | null = null;

  static async open(widgetKey: string): Promise<Call> {
    const call = new Call();
    const session = await createSessionRoute(post("/api/widget/session", { widgetKey }));
    call.cookie = session.cookies.get(WIDGET_COOKIE)!.value;
    const sessionBody = (await session.json()) as { sessionId: string; settings: { voiceAssistant: { engine: string } } };
    call.sessionId = sessionBody.sessionId;
    if (sessionBody.settings.voiceAssistant.engine !== "gemini") throw new Error(`engine is ${sessionBody.settings.voiceAssistant.engine}, not gemini`);
    const grantResponse = await geminiSessionRoute(post("/api/widget/voice/gemini/session", {}, call.cookie));
    const grant = (await grantResponse.json()) as { token: string; wsUrl: string; model: string; opener: string; error?: { message?: string } };
    if (!grant.token) throw new Error(`session failed: ${grant.error?.message ?? grantResponse.status}`);
    call.ws = new WebSocket(`${grant.wsUrl}?access_token=${encodeURIComponent(grant.token)}`);
    call.ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("setup timed out")), 20_000);
      call.ws.onopen = () => call.ws.send(JSON.stringify({ setup: { model: `models/${grant.model}` } }));
      call.ws.onclose = (event) => reject(new Error(`closed during setup: ${event.code} ${event.reason}`));
      call.ws.onmessage = (event) => {
        const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8")) as ServerMessage;
        if (message.setupComplete !== undefined) {
          clearTimeout(timer);
          call.ws.onclose = null;
          call.ws.onmessage = (next) => {
            const parsed = JSON.parse(typeof next.data === "string" ? next.data : Buffer.from(next.data as ArrayBuffer).toString("utf8")) as ServerMessage;
            call.listener?.(parsed);
          };
          resolve();
        }
      };
    });
    call.greeting = await call.turn({ text: grant.opener, label: "(opener)", saveUser: false });
    return call;
  }

  private send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }

  async turn(input: { text?: string; audio?: Int16Array; label?: string; saveUser?: boolean }): Promise<TurnLog> {
    const log: TurnLog = {
      input: input.label ?? input.text ?? "",
      mode: input.audio ? "audio" : "text",
      heard: "",
      reply: "",
      tools: [],
      shown: [],
      firstAudioMs: null,
      audioMs: 0,
      tokens: emptyTotals(),
      doneMs: 0,
      timedOut: false,
    };
    let inputEndedAt = performance.now();
    let pending = 0;
    let userSaved = input.saveUser === false;
    let speechStartedAt = performance.now();
    const saveUser = async () => {
      if (userSaved) return;
      userSaved = true;
      const text = input.audio ? log.heard.trim() : input.text!;
      if (text) await transcriptRoute(post("/api/widget/voice/realtime/transcript", { role: "user", text }, this.cookie));
    };

    let kick = () => undefined as void;
    const finished = new Promise<void>((resolve) => {
      let idle: NodeJS.Timeout | null = null;
      const hardStop = setTimeout(() => {
        log.timedOut = true;
        resolve();
      }, 75_000);
      const settle = (): void => {
        if (idle) clearTimeout(idle);
        // A turn can continue after tool results; it's done when nothing more arrives for a moment.
        idle = setTimeout(() => {
          clearTimeout(hardStop);
          resolve();
        }, 2_500);
      };
      kick = settle;
      this.listener = (message) => {
        if (idle) clearTimeout(idle);
        const content = message.serverContent;
        if (message.usageMetadata) {
          const usage = normalizeGeminiUsage(message.usageMetadata);
          if (usage) {
            addTotals(log.tokens, {
              input: usage.inputTokens,
              cached: usage.cachedInputTokens,
              output: usage.outputTokens,
              reasoning: usage.reasoningTokens,
              audioIn: usage.audioInputTokens + usage.cachedAudioInputTokens,
              audioOut: usage.audioOutputTokens,
              requests: 1,
            });
          }
        }
        if (content?.inputTranscription?.text) log.heard += content.inputTranscription.text;
        if (content?.outputTranscription?.text) log.reply += content.outputTranscription.text;
        for (const part of content?.modelTurn?.parts ?? []) {
          if (part.thought || !part.inlineData?.data) continue;
          if (log.firstAudioMs === null) log.firstAudioMs = Math.round(performance.now() - inputEndedAt);
          // 24 kHz, 16-bit mono: 48 bytes per millisecond.
          log.audioMs += Math.round((part.inlineData.data.length * 3) / 4 / 48);
        }
        for (const call of message.toolCall?.functionCalls ?? []) {
          pending += 1;
          void (async () => {
            await saveUser();
            const started = performance.now();
            const response = await toolRoute(
              post(
                "/api/widget/voice/realtime/tool",
                { name: call.name, arguments: JSON.stringify(call.args ?? {}), speechAgoMs: Math.round(performance.now() - speechStartedAt) },
                this.cookie,
              ),
            );
            const body = (await response.json()) as { output?: string; ui?: Array<{ type: string; url?: string; products?: Array<{ name: string }> }> };
            const output = body.output ?? JSON.stringify({ ok: false, error: { code: "route_failed" } });
            const shown = (body.ui ?? []).flatMap((part) => (part.type === "product_list" ? (part.products ?? []).map((product) => product.name) : []));
            let parsed: Record<string, unknown>;
            try {
              const value = JSON.parse(output) as unknown;
              parsed = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { result: value };
            } catch {
              parsed = { result: output };
            }
            log.tools.push({ name: call.name, args: call.args ?? {}, ok: parsed.ok !== false, shown, uiTypes: (body.ui ?? []).map((part) => part.type), url: body.ui?.find((part) => part.type === "navigate")?.url, ms: Math.round(performance.now() - started) });
            if (shown.length) log.shown = shown;
            this.send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: parsed }] } });
            pending -= 1;
            // If the model says nothing more after the result, the turn still ends.
            if (pending === 0) kick();
          })();
        }
        if (content?.turnComplete && pending === 0) settle();
        else if (pending === 0 && (log.reply || log.tools.length)) settle();
      };
    });

    if (input.audio) {
      // Real-time pacing: 40 ms chunks, then a pause so the model hears the end of the sentence.
      speechStartedAt = performance.now();
      const chunk = 640;
      const silence = new Int16Array(16_000 * 1.6);
      const all = new Int16Array(input.audio.length + silence.length);
      all.set(input.audio);
      for (let i = 0; i < all.length; i += chunk) {
        const piece = all.subarray(i, i + chunk);
        this.send({ realtimeInput: { audio: { data: Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
        if (i === input.audio.length - (input.audio.length % chunk)) inputEndedAt = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      inputEndedAt = Math.min(inputEndedAt, performance.now());
    } else {
      await saveUser();
      inputEndedAt = performance.now();
      this.send({ clientContent: { turns: [{ role: "user", parts: [{ text: input.text }] }], turnComplete: true } });
    }
    const started = performance.now();
    await finished;
    await saveUser();
    log.doneMs = Math.round(performance.now() - started);
    if (log.reply.trim()) await transcriptRoute(post("/api/widget/voice/realtime/transcript", { role: "assistant", text: log.reply.trim() }, this.cookie));
    return log;
  }

  async cart(storeId: string) {
    return getCartSummary(this.sessionId, storeId, "BDT");
  }

  close() {
    try {
      this.ws.close(1000);
    } catch {
      // Already closed.
    }
  }
}

// --- scoring -------------------------------------------------------------------------------------

type Check = { scenario: string; check: string; pass: boolean; detail: string };
const checks: Check[] = [];
const transcripts: Array<{ scenario: string; greeting?: TurnLog | null; turns: TurnLog[] }> = [];
const BANGLA = /[ঀ-৿]/;
const isBangla = (text: string) => {
  const letters = text.replace(/[^A-Za-zঀ-৿]/g, "");
  if (!letters) return false;
  return (letters.match(/[ঀ-৿]/g)?.length ?? 0) / letters.length > 0.5;
};

function record(scenario: string, check: string, pass: boolean, detail = "") {
  checks.push({ scenario, check, pass, detail });
}

const toolNames = (turn: TurnLog) => turn.tools.map((tool) => tool.name);
const short = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max)}…` : text);

// --- the checkup ---------------------------------------------------------------------------------

describe.skipIf(!SOURCE_URL || !GEMINI_KEY)("Gemini Live voice checkup", () => {
  it("obeys commands, shows exact products, handles cart and orders", { timeout: 1_800_000 }, async () => {
    const store = await copyStore();
    const products = await prisma.product.findMany({ where: { status: "active" }, include: { variants: true } });
    const categoryOf = new Map(products.map((product) => [product.name, product.category]));
    const priceOf = new Map(products.map((product) => [product.name, product.priceMinor]));
    const widgetKey = store.widgetKey;

    const scenario = async (name: string, run: (call: Call, turns: TurnLog[]) => Promise<void>) => {
      const turns: TurnLog[] = [];
      let call: Call | null = null;
      try {
        call = await Call.open(widgetKey);
        transcripts.push({ scenario: name, greeting: call.greeting, turns });
        await run(call, turns);
      } catch (error) {
        record(name, "scenario ran", false, error instanceof Error ? error.message : String(error));
        transcripts.push({ scenario: name, turns });
      } finally {
        call?.close();
      }
    };
    const say = async (call: Call, turns: TurnLog[], text: string) => {
      const turn = await call.turn({ text });
      turns.push(turn);
      return turn;
    };
    const speakTurn = async (call: Call, turns: TurnLog[], text: string) => {
      const audio = await speak(text);
      const turn = await call.turn({ audio, label: `🎙 ${text}` });
      turns.push(turn);
      return turn;
    };

    await setLanguage("auto");

    await scenario("Greeting", async (call) => {
      const greeting = call.greeting!;
      record("Greeting", "greets in Bangla without tools", isBangla(greeting.reply) && greeting.tools.length === 0, short(greeting.reply));
      record("Greeting", "first audio latency", greeting.firstAudioMs !== null, `${greeting.firstAudioMs} ms`);
    });

    await scenario("Browse all products", async (call, turns) => {
      const turn = await say(call, turns, "আপনাদের কি কি প্রোডাক্ট আছে?");
      record("Browse all products", "calls search_products", toolNames(turn).includes("search_products"), toolNames(turn).join(", "));
      record("Browse all products", "shows the whole range (≥10 cards)", turn.shown.length >= 10, `${turn.shown.length} shown`);
      record("Browse all products", "replies in Bangla", isBangla(turn.reply), short(turn.reply));
    });

    await scenario("Show bags (exact category)", async (call, turns) => {
      const turn = await say(call, turns, "ব্যাগ দেখান");
      const bags = products.filter((product) => product.category === "Bags").map((product) => product.name);
      const wrong = turn.shown.filter((name) => categoryOf.get(name) !== "Bags");
      record("Show bags (exact category)", "shows every bag", bags.every((bag) => turn.shown.includes(bag)), `shown: ${turn.shown.join(", ") || "none"}`);
      record("Show bags (exact category)", "shows nothing but bags", turn.shown.length > 0 && wrong.length === 0, wrong.length ? `extra: ${wrong.join(", ")}` : "");
    });

    await scenario("Show earbuds (English)", async (call, turns) => {
      const turn = await say(call, turns, "Show me wireless earbuds");
      record("Show earbuds (English)", "shows Wireless Earbuds Pro first", turn.shown[0] === "Wireless Earbuds Pro", `shown: ${turn.shown.join(", ") || "none"}`);
      record("Show earbuds (English)", "replies in English", turn.reply.length > 0 && !BANGLA.test(turn.reply), short(turn.reply));
    });

    await scenario("Red scarf (colour filter)", async (call, turns) => {
      const turn = await say(call, turns, "লাল রঙের স্কার্ফ আছে?");
      record("Red scarf (colour filter)", "shows Handloom Scarf", turn.shown.includes("Handloom Scarf"), `shown: ${turn.shown.join(", ") || "none"} · args ${JSON.stringify(turn.tools[0]?.args ?? {})}`);
    });

    await scenario("Budget filter", async (call, turns) => {
      const turn = await say(call, turns, "তিন হাজার টাকার নিচে কি কি ইলেকট্রনিক্স আছে?");
      const over = turn.shown.filter((name) => (priceOf.get(name) ?? 0) > 300_000);
      const notElectronics = turn.shown.filter((name) => categoryOf.get(name) !== "Electronics");
      record("Budget filter", "shows the Power Bank (2,800)", turn.shown.includes("Power Bank 20000mAh"), `shown: ${turn.shown.join(", ") || "none"}`);
      record("Budget filter", "nothing over 3,000 or off-category", turn.shown.length > 0 && over.length === 0 && notElectronics.length === 0, [over.length ? `over: ${over.join(", ")}` : "", notElectronics.length ? `other: ${notElectronics.join(", ")}` : ""].filter(Boolean).join(" · "));
    });

    await scenario("Cart: add, change, remove", async (call, turns) => {
      const show = await say(call, turns, "ব্যাকপ্যাক দেখান");
      record("Cart: add, change, remove", "shows Urban Trek Backpack", show.shown.includes("Urban Trek Backpack"), `shown: ${show.shown.join(", ") || "none"}`);
      await say(call, turns, "অলিভ কালারটা কার্টে দিন");
      let cart = await call.cart(store.id);
      const added = cart.items.find((item) => item.name === "Urban Trek Backpack");
      record("Cart: add, change, remove", "adds the Olive backpack", added?.variantTitle === "Olive" && added.quantity === 1, cart.items.map((item) => `${item.name} (${item.variantTitle}) x${item.quantity}`).join(", ") || "cart empty");
      await say(call, turns, "ওটা দুইটা করে দিন");
      cart = await call.cart(store.id);
      record("Cart: add, change, remove", "changes quantity to 2", cart.items.find((item) => item.name === "Urban Trek Backpack")?.quantity === 2, cart.items.map((item) => `${item.name} x${item.quantity}`).join(", ") || "cart empty");
      await say(call, turns, "না থাক, ব্যাকপ্যাকটা কার্ট থেকে বাদ দিন");
      cart = await call.cart(store.id);
      record("Cart: add, change, remove", "removes it", !cart.items.some((item) => item.name === "Urban Trek Backpack"), cart.items.map((item) => `${item.name} x${item.quantity}`).join(", ") || "cart empty");
    });

    await scenario("Sold-out version", async (call, turns) => {
      const turn = await say(call, turns, "কালো লেদার বেল্টের ঘড়িটা কার্টে দিন");
      const cart = await call.cart(store.id);
      const black = cart.items.some((item) => item.variantTitle === "Black / Black leather");
      record("Sold-out version", "doesn't add the sold-out black watch", !black, cart.items.map((item) => `${item.name} (${item.variantTitle})`).join(", ") || "cart empty");
      record("Sold-out version", "tells the customer (reply)", turn.reply.length > 0, short(turn.reply));
    });

    await scenario("Pick by number", async (call, turns) => {
      const browse = await say(call, turns, "সব প্রোডাক্ট দেখান");
      const third = browse.shown[2];
      await say(call, turns, "তিন নম্বরটা কার্টে দিন");
      const cart = await call.cart(store.id);
      const pick = turns.at(-1)!;
      const variants = products.find((product) => product.name === third)?.variants.filter((variant) => variant.stockStatus !== "out_of_stock").length ?? 0;
      const added = cart.items.some((item) => item.name === third);
      const wrong = cart.items.filter((item) => item.name !== third);
      // With several versions in stock, asking which one is right; otherwise it should add it.
      record(
        "Pick by number",
        "acts on the 3rd product on screen",
        Boolean(third) && wrong.length === 0 && (added || (variants > 1 && pick.reply.length > 0)),
        `3rd shown: ${third ?? "none"} (${variants} versions in stock) · cart: ${cart.items.map((item) => item.name).join(", ") || "empty"} · ${short(pick.reply)}`,
      );
    });

    await scenario("Not sold here", async (call, turns) => {
      const turn = await say(call, turns, "আপনাদের কাছে ল্যাপটপ আছে?");
      record("Not sold here", "says plainly that laptops aren't sold", /নেই|পাওয়া যায় না|বিক্রি করি না|don't|do not|not available|no laptop/i.test(turn.reply), `shown: ${turn.shown.join(", ") || "none"} · ${short(turn.reply)}`);
    });

    await scenario("Store question", async (call, turns) => {
      const turn = await say(call, turns, "ঢাকার ভেতরে ডেলিভারি চার্জ কত?");
      record("Store question", "answers (store info or knowledge)", turn.reply.length > 0, `${toolNames(turn).join(", ") || "no tool"} · ${short(turn.reply, 200)}`);
    });

    await scenario("Compare products", async (call, turns) => {
      const turn = await say(call, turns, "ইয়ারবাডস আর ফিটনেস ব্যান্ডের মধ্যে পার্থক্য কি?");
      const used = toolNames(turn);
      record("Compare products", "looks the products up", used.some((name) => ["compare_products", "get_product_details", "search_products"].includes(name)), `${used.join(", ") || "no tool"} · ${short(turn.reply)}`);
    });

    await scenario("Open product page", async (call, turns) => {
      const turn = await say(call, turns, "ব্যাকপ্যাকের পেজটা খুলুন");
      const opened = turn.tools.find((tool) => tool.name === "open_product_page");
      record("Open product page", "opens the backpack page", Boolean(opened?.uiTypes.includes("navigate")), `${toolNames(turn).join(", ") || "no tool"} ${JSON.stringify(opened?.args ?? {})}`);
    });

    const slugOf = new Map(products.map((product) => [product.name, product.slug]));
    const navigatedTo = (turn: TurnLog) => turn.tools.find((tool) => tool.url)?.url ?? null;

    await scenario("Details, then the page", async (call, turns) => {
      const details = await say(call, turns, "ব্যাকপ্যাকের details বলেন");
      record("Details, then the page", "details: shows the card, doesn't jump to the page", details.shown.includes("Urban Trek Backpack") && !navigatedTo(details), `${toolNames(details).join(", ") || "no tool"} · ${short(details.reply)}`);
      record("Details, then the page", "offers to open the page", /পেজ|page/i.test(details.reply), short(details.reply));
      const page = await say(call, turns, "হ্যাঁ, পেজটা খুলে দিন");
      record("Details, then the page", "opens the backpack page", navigatedTo(page) === `/products/${slugOf.get("Urban Trek Backpack")}`, `${toolNames(page).join(", ") || "no tool"} → ${navigatedTo(page) ?? "no page"}`);
      record("Details, then the page", "no card pops over the page", page.shown.length === 0, page.shown.length ? `cards: ${page.shown.join(", ")}` : "");
    });

    await scenario("Open a page by number", async (call, turns) => {
      const browse = await say(call, turns, "সব প্রোডাক্ট দেখান");
      const second = browse.shown[1];
      const page = await say(call, turns, "২ নম্বরটার পেজ খুলুন");
      record("Open a page by number", "opens the 2nd product's page", Boolean(second) && navigatedTo(page) === `/products/${slugOf.get(second!)}`, `2nd shown: ${second ?? "none"} → ${navigatedTo(page) ?? "no page"} (${JSON.stringify(page.tools.find((tool) => tool.name === "open_product_page")?.args ?? {})})`);
    });

    await scenario("Full order", async (call, turns) => {
      await say(call, turns, "আমি একটা কটন কুর্তি মিডিয়াম সাইজ অর্ডার করতে চাই");
      const cart = await call.cart(store.id);
      record("Full order", "adds Cotton Kurti (Medium)", cart.items.some((item) => item.name === "Cotton Kurti" && item.variantTitle === "Medium"), cart.items.map((item) => `${item.name} (${item.variantTitle})`).join(", ") || "cart empty");
      const details = [
        "আমার নাম রাকিব হাসান",
        "আমার ফোন নাম্বার 01712345678",
        "ঠিকানা বাড়ি ১২, রোড ৫, ধানমন্ডি, ঢাকা",
      ];
      for (const text of details) await say(call, turns, text);
      let order = null;
      for (const text of ["হ্যাঁ, অর্ডার কনফার্ম করেন", "হ্যাঁ, ঠিক আছে কনফার্ম", "হ্যাঁ"]) {
        await say(call, turns, text);
        order = await prisma.order.findFirst({ where: { sessionId: call.sessionId } });
        if (order) break;
      }
      record("Full order", "places the order", Boolean(order), order ? `${order.orderNumber}` : "no order after 3 confirmations");
      if (order) {
        record("Full order", "order has the right item", order.items.some((item) => item.name === "Cotton Kurti" && item.variantTitle === "Medium"), order.items.map((item) => `${item.name} (${item.variantTitle}) x${item.quantity}`).join(", "));
        record("Full order", "order has the right customer", order.customer.phone.replace(/\D/g, "").endsWith("1712345678") && /রাকিব|rakib/i.test(order.customer.name), `${order.customer.name} · ${order.customer.phone} · ${order.customer.address}`);
      }
      const proposeTurn = turns.findIndex((turn) => toolNames(turn).includes("propose_order"));
      const confirmTurn = turns.findIndex((turn) => toolNames(turn).includes("confirm_order"));
      record("Full order", "summary before confirming", proposeTurn !== -1 && (confirmTurn === -1 || proposeTurn < confirmTurn), `propose turn ${proposeTurn}, confirm turn ${confirmTurn}`);
    });

    await setLanguage("bn");
    await scenario("Language fixed to Bangla", async (call, turns) => {
      const turn = await say(call, turns, "Do you have any backpacks?");
      record("Language fixed to Bangla", "English question → Bangla reply", isBangla(turn.reply), short(turn.reply));
      const mixed = await say(call, turns, "ok, price koto?");
      record("Language fixed to Bangla", "mixed Banglish → Bangla reply", isBangla(mixed.reply), short(mixed.reply));
    });

    // Spoken commands: what the model hears, and whether it acts on it.
    await setLanguage("auto");
    await scenario("Spoken: show bags", async (call, turns) => {
      const turn = await speakTurn(call, turns, "ব্যাগ দেখান");
      record("Spoken: show bags", "hears it", turn.heard.trim().length > 0, `heard: "${turn.heard.trim()}"`);
      record("Spoken: show bags", "shows bags", turn.shown.length > 0 && turn.shown.every((name) => categoryOf.get(name) === "Bags"), `shown: ${turn.shown.join(", ") || "none"}`);
    });
    await scenario("Spoken: earbuds", async (call, turns) => {
      const turn = await speakTurn(call, turns, "আমাকে ওয়্যারলেস ইয়ারবাডস দেখান");
      record("Spoken: earbuds", "hears it", turn.heard.trim().length > 0, `heard: "${turn.heard.trim()}"`);
      record("Spoken: earbuds", "shows Wireless Earbuds Pro", turn.shown.includes("Wireless Earbuds Pro"), `shown: ${turn.shown.join(", ") || "none"}`);
    });
    await scenario("Spoken: add to cart", async (call, turns) => {
      await speakTurn(call, turns, "ব্যাকপ্যাক দেখান");
      const add = await speakTurn(call, turns, "অলিভ কালারের ব্যাকপ্যাকটা কার্টে দিন");
      const cart = await call.cart(store.id);
      record("Spoken: add to cart", "hears it", add.heard.trim().length > 0, `heard: "${add.heard.trim()}"`);
      record("Spoken: add to cart", "adds the Olive backpack", cart.items.some((item) => item.name === "Urban Trek Backpack" && item.variantTitle === "Olive"), cart.items.map((item) => `${item.name} (${item.variantTitle})`).join(", ") || "cart empty");
    });
    await scenario("Spoken: English sandals", async (call, turns) => {
      const turn = await speakTurn(call, turns, "Show me leather sandals in size forty two");
      record("Spoken: English sandals", "hears it", turn.heard.trim().length > 0, `heard: "${turn.heard.trim()}"`);
      record("Spoken: English sandals", "shows Leather Sandals", turn.shown.includes("Leather Sandals"), `shown: ${turn.shown.join(", ") || "none"}`);
      record("Spoken: English sandals", "replies in English", turn.reply.length > 0 && !BANGLA.test(turn.reply), short(turn.reply));
    });
    await scenario("Background noise", async (call, turns) => {
      await speakTurn(call, turns, "ব্যাগ দেখান");
      // Two seconds of low-level hiss (a fan, street noise): not the customer.
      const noise = new Int16Array(16_000 * 2).map(() => Math.round((Math.random() - 0.5) * 2 * 900));
      const turn = await call.turn({ audio: noise, label: "(2 s of background noise)" });
      turns.push(turn);
      record("Background noise", "doesn't treat noise as the customer", turn.reply.trim() === "" && turn.tools.length === 0, `heard: "${turn.heard.trim()}" · reply: ${short(turn.reply) || "none"}`);
    });

    await scenario("Spoken: phone number", async (call, turns) => {
      const turn = await speakTurn(call, turns, "আমার ফোন নাম্বার শূন্য এক সাত এক দুই তিন চার পাঁচ ছয় সাত আট");
      const digits = (turn.heard + " " + turn.reply).replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
      record("Spoken: phone number", "hears the number", turn.heard.trim().length > 0, `heard: "${turn.heard.trim()}"`);
      record("Spoken: phone number", "gets the digits right (heard or read back)", /0?1712345678/.test(digits.replace(/\D/g, "")), `reply: ${short(turn.reply)}`);
    });

    // --- report --------------------------------------------------------------------------------
    const allTurns = transcripts.flatMap((entry) => [...(entry.greeting ? [entry.greeting] : []), ...entry.turns]);
    const firstAudio = allTurns.map((turn) => turn.firstAudioMs).filter((ms): ms is number => ms !== null).sort((a, b) => a - b);
    const toolMs = allTurns.flatMap((turn) => turn.tools.map((tool) => tool.ms)).sort((a, b) => a - b);
    const pct = (list: number[], p: number) => (list.length ? list[Math.min(list.length - 1, Math.floor(list.length * p))] : null);
    const passed = checks.filter((check) => check.pass).length;
    const longest = [...allTurns].sort((a, b) => b.audioMs - a.audioMs)[0];
    const lines = [
      `VOICE CHECKUP: ${passed}/${checks.length} checks passed`,
      `latency to first audio: median ${pct(firstAudio, 0.5)} ms, p90 ${pct(firstAudio, 0.9)} ms (${firstAudio.length} replies)`,
      `tool round-trip on server: median ${pct(toolMs, 0.5)} ms, p90 ${pct(toolMs, 0.9)} ms`,
      `timed-out turns: ${allTurns.filter((turn) => turn.timedOut).length}`,
      `tokens: ${formatTotals(allTurns.reduce((total, turn) => (addTotals(total, turn.tokens), total), emptyTotals()))} · about ${Math.round(allTurns.reduce((sum, turn) => sum + turn.tokens.input + turn.tokens.cached + turn.tokens.output, 0) / Math.max(1, allTurns.length)).toLocaleString("en-US")} per turn`,
      `longest spoken reply: ${longest ? `${(longest.audioMs / 1000).toFixed(1)} s ("${short(longest.input, 50)}")` : "none"}`,
      "",
      ...checks.map((check) => `${check.pass ? "PASS" : "FAIL"}  ${check.scenario} › ${check.check}${check.detail ? `  —  ${check.detail}` : ""}`),
    ];
    console.log(lines.join("\n"));
    if (REPORT_PATH) writeFileSync(REPORT_PATH, JSON.stringify({ summary: lines, checks, transcripts }, null, 2));
  });
});
