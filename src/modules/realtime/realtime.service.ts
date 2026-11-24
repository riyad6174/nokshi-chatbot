import { env } from "@/lib/config/env";
import { decryptSecret } from "@/lib/crypto/secrets";
import { logger } from "@/lib/logging/logger";
import { resolveAiConfig } from "@/modules/ai/config";
import { resolveSalesConfig, type ReplyLanguagePreference } from "@/modules/sales/config";
import { priceLabel } from "@/lib/money";
import { buildSystemInstructions, nextOrderStep } from "@/modules/ai/system-instructions";
import { getLiveCallTools } from "@/modules/ai/tools";
import { compactToolContent } from "@/modules/ai/tools/helpers";
import type { ToolExecutionResult } from "@/modules/ai/tools/types";
import { getCartSummary } from "@/modules/cart/cart.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { savedDetailsForVisitor, type SavedDetails } from "@/modules/customers/profile.service";
import { describeOpenProposal } from "@/modules/orders/voice-order.service";
import type { StoreWithSettings } from "@/modules/stores/store.service";
import type { ChatPart, VoiceEngine } from "@/types/chat";

// Live voice over the OpenAI Realtime API: one streaming model hears the customer, decides and
// speaks, over WebRTC straight from the browser. Our server keeps the important parts: it builds
// the instructions, mints a short-lived browser token (the store's key never leaves the server) and
// runs every tool against the database, exactly like text chat.

const OPENAI_BASE = "https://api.openai.com/v1";
const SECRET_TTL_SECONDS = 600;

export class RealtimeError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "RealtimeError";
    this.status = status;
  }
}

/** Live voice settings: what's set in Admin → AI model, otherwise the VOICE_ENGINE / REALTIME_* env. */
export function realtimeSettings(store: Pick<StoreWithSettings, "settings">) {
  const settings = store.settings;
  const saved = settings?.voiceEngine;
  const engine: VoiceEngine = saved === "gemini" || saved === "realtime" || saved === "cascade" ? saved : env.VOICE_ENGINE;
  const speed = settings?.realtimeVoiceSpeed;
  return {
    engine,
    model: settings?.realtimeModel?.trim() || env.REALTIME_MODEL,
    voice: settings?.realtimeVoice?.trim() || env.REALTIME_VOICE,
    speed: typeof speed === "number" && speed >= 0.75 && speed <= 1.4 ? speed : env.REALTIME_VOICE_SPEED,
    style: settings?.realtimeVoiceStyle?.trim() || env.REALTIME_VOICE_STYLE,
  };
}

/**
 * The OpenAI key realtime runs on: the voice key from Admin → AI model, otherwise the store's AI key
 * when the store uses OpenAI. Null otherwise.
 */
export function realtimeApiKey(store: Pick<StoreWithSettings, "settings">): string | null {
  const voiceKey = decryptSecret(store.settings?.realtimeApiKeyEncrypted);
  if (voiceKey) return voiceKey;
  const config = resolveAiConfig(store.settings);
  if (!config || config.kind !== "openai-compatible" || !config.baseUrl.startsWith(OPENAI_BASE) || !config.apiKey) return null;
  return config.apiKey;
}

/**
 * The Gemini key live voice runs on: the voice key from Admin → AI model, otherwise the AI model key
 * when the store's AI provider is Google Gemini. Null otherwise.
 */
export function geminiLiveApiKey(store: Pick<StoreWithSettings, "settings">): string | null {
  const voiceKey = decryptSecret(store.settings?.geminiApiKeyEncrypted);
  if (voiceKey) return voiceKey;
  const config = resolveAiConfig(store.settings);
  if (!config || !config.apiKey || !config.baseUrl.includes("generativelanguage.googleapis.com")) return null;
  return config.apiKey;
}

/**
 * Which voice engine this store's widget uses: the one chosen in Admin → AI model when its key is
 * available. Without one, the other live engine if it has a key, and the cascade as the last resort,
 * so a missing key never leaves customers without voice.
 */
export function voiceEngine(store: Pick<StoreWithSettings, "settings">): VoiceEngine {
  const chosen = realtimeSettings(store).engine;
  if (chosen === "cascade") return "cascade";
  const gemini = geminiLiveApiKey(store) !== null;
  const openai = realtimeApiKey(store) !== null;
  if (chosen === "gemini" && gemini) return "gemini";
  if (chosen === "realtime" && openai) return "realtime";
  if (gemini) return "gemini";
  if (openai) return "realtime";
  return "cascade";
}

/** Whether this store's live-call routes (tool, transcript, usage) should accept requests. */
export function liveVoiceActive(store: Pick<StoreWithSettings, "settings">): boolean {
  return voiceEngine(store) !== "cascade";
}

/** What to say before a tool call that takes a moment. Varied, so it doesn't sound scripted. */
export const WAIT_FILLERS = ["বুঝেছি, একটু সময় দিবেন", "আচ্ছা একটু সময় চেয়ে নিচ্ছি", "একটু অপেক্ষা করুন", "বুঝেছি, একটু অপেক্ষা করুন"];
const WAIT_FILLERS_EN = ["One moment, please.", "Just a moment.", "Got it, give me a second.", "Sure, let me check."];

/** The language the store chose in Admin → AI Sales & Engagement ("auto" follows the customer). */
export function storeLanguage(store: Pick<StoreWithSettings, "settings">): ReplyLanguagePreference {
  return resolveSalesConfig(store.settings).language;
}

// The last filler given out per conversation, so the next one is always different. In memory: after
// a restart (or on another server instance) the next pick is just random.
const lastFiller = new Map<string, { text: string; at: number }>();

/**
 * A random wait filler, never the same as the one this conversation got last time. The server picks
 * it, not the model: told to choose or rotate on its own, a model settles on one phrase and repeats
 * it every time.
 */
export function pickWaitFiller(
  conversationId: string | null | undefined,
  random: () => number = Math.random,
  language: ReplyLanguagePreference = "auto",
): string {
  const now = Date.now();
  for (const [key, entry] of lastFiller) if (now - entry.at > 30 * 60_000) lastFiller.delete(key);
  const last = conversationId ? lastFiller.get(conversationId)?.text : undefined;
  const pool = language === "en" ? WAIT_FILLERS_EN : WAIT_FILLERS;
  const options = pool.filter((text) => text !== last);
  const text = options[Math.floor(random() * options.length)] ?? pool[0]!;
  if (conversationId) lastFiller.set(conversationId, { text, at: now });
  return text;
}

/**
 * Call rules. The model gets exactly one filler to say at a time: `firstFiller` for the first pause,
 * then a fresh `nextFiller` with every tool result (see toolOutputForModel). Fixed for the whole call,
 * so the prompt cache isn't affected.
 */
export function liveCallRules(firstFiller: string): string {
  return `LIVE CALL: you are on a real-time voice call. You hear the customer directly and they hear you as you speak.
- Say your one short sentence, then stop and let them talk. No explanations they didn't ask for. If they interrupt, stop and listen.
- Before a tool call that takes a moment, you may say one short filler, then go quiet until the result arrives. Say exactly the filler you were given most recently, word for word: "${firstFiller}" for the first pause; after that, the "nextFiller" in the latest tool result (it changes every time, so you never sound repetitive). Never reuse an earlier filler and never make up your own (no "একটু দেখি", "এক মিনিট"). Speaking English: "One moment, please…" or "Just a moment…".
${LIVE_CALL_RULES_REST}`;
}

const LIVE_CALL_RULES_REST = `- Ending the call: never end it on your own after an order or answer; ask if they need anything else. When they're done ("না, ধন্যবাদ", "আর কিছু লাগবে না", "that's all", "bye") or ask to hang up, call end_call, then say one short warm goodbye. Never call end_call while they still want something.
- Noise: if what you heard is meaningless (a stray sound, or a word in a language nobody here speaks, like "¿Qué", "de", "A"), ignore it: don't answer it and don't repeat your last sentence, just keep listening. If you were cut off, don't start the same sentence again word for word: finish it in a few words, or ask what they said.
- Phone numbers: repeat them back digit by digit once, naturally, as part of your reply (don't ask them to confirm it separately).
- A tool result with "orderState" is the latest cart, order and next step: it replaces CURRENT CART, OPEN ORDER and the next step above.
`;

// What makes a voice sound like a person rather than an AI: everyday spoken words, not written ones.
const SOUND_HUMAN_EN = `SOUND LIKE A REAL PERSON, NOT AN AI:
- Speak casual, warm, everyday English, like a friendly shop assistant on the phone: contractions ("it's", "you'll"), "Sure!", "Got it", "Nice pick!".
- Say prices the spoken way: "twelve hundred taka", "four and a half thousand taka".
- Vary your rhythm: short replies, natural pauses, a smile in your voice. Never read like a script.`;

/** The last words of the call instructions (voice models follow the end of the prompt most closely). */
function languageReminder(language: ReplyLanguagePreference): string {
  if (language === "bn") {
    return "LANGUAGE (most important): speak ONLY Bangla on this call, every single reply, even when the customer uses English words. Speak English only if they explicitly ask you to.";
  }
  if (language === "en") {
    return "LANGUAGE (most important): speak ONLY English on this call, every single reply. Speak Bangla only if the customer explicitly asks you to.";
  }
  return "LANGUAGE: start in Bangla. Bangla mixed with English words is Bangla. Switch only when the customer speaks whole sentences in English, and don't switch back and forth.";
}

const SOUND_HUMAN = `SOUND LIKE A REAL PERSON, NOT AN AI:
- Speak everyday spoken Bangladeshi Bangla, the way a friendly shop assistant in Dhaka talks on the phone. Never formal or written Bangla.
  Natural: "আচ্ছা, দেখাচ্ছি।" · "এইটা নিবেন?" · "দাম পড়বে বারোশো টাকা।" · "ঠিক আছে, অর্ডার করে দিচ্ছি।" · "নাম্বারটা একটু বলবেন?" · "কোথায় পাঠাবো?"
  Not this: "অনুগ্রহ করে", "আপনার সুবিধার্থে", "প্রদান করুন", "আপনি কি ইচ্ছুক", "নিশ্চিত করুন", "আমি আপনাকে সহায়তা করতে পারি".
- Use the English words Bangladeshis actually say: অর্ডার, ডেলিভারি, কনফার্ম, প্রোডাক্ট, সাইজ, কালার, ক্যাশ অন ডেলিভারি, ফোন নাম্বার.
- Say prices the spoken way: "বারোশো টাকা", "সাড়ে চার হাজার টাকা", not digits read one by one.
- In English, sound casual and warm too: contractions ("it's", "you'll"), "Sure!", "Got it", "Nice pick!".
- Vary your rhythm: short replies, natural pauses ("হুম… এইটা ভালো হবে"), a smile in your voice. Never read like a script.`;

/**
 * The cart, order and next step as they are now: a few lines sent with a tool result after the cart
 * or order changes. Sent this way instead of replacing the session instructions, because changing the
 * instructions mid-call invalidates the prompt cache for everything after them (tools, the whole
 * conversation, its audio), so every later reply would be billed in full.
 */
export async function realtimeStateNote(context: SessionContext): Promise<string> {
  const [cart, openOrder, savedDetails] = await Promise.all([
    getCartSummary(context.sessionId, context.storeId, context.store.currency),
    describeOpenProposal(context).catch(() => null),
    savedDetailsForVisitor(context.storeId, context.visitorId).catch(() => null),
  ]);
  const items =
    cart.items.length === 0
      ? "empty"
      : `${cart.items
          .map((item) => `${item.name}${item.variantTitle ? ` (${item.variantTitle})` : ""} x${item.quantity}`)
          .join(", ")}; subtotal ${priceLabel(cart.subtotalMinor, cart.currency)}`;
  return [
    `Cart now: ${items}.`,
    openOrder ? `Open order: ${openOrder}` : "",
    `Next step: ${nextOrderStep({ cart, savedDetails, openOrder, channel: "voice" })}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Writes down what the customer says on a live call (billed separately; recorded in the usage ledger). */
export const REALTIME_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

/** Session instructions for the current state of the customer's cart, order and saved details. */
export async function realtimeInstructions(context: SessionContext): Promise<string> {
  const [cart, openOrder, savedDetails] = await Promise.all([
    getCartSummary(context.sessionId, context.storeId, context.store.currency),
    describeOpenProposal(context).catch(() => null),
    savedDetailsForVisitor(context.storeId, context.visitorId).catch(() => null),
  ]);
  const settings = context.store.settings;
  const base = buildSystemInstructions({
    session: context,
    cart,
    configuredInstructions: settings?.systemInstructions,
    enabledFeatures: settings?.enabledFeatures,
    channel: "voice",
    openOrder,
    savedDetails,
    replyLanguage: "auto",
    liveCall: true,
  });
  const language = storeLanguage(context.store);
  return `${base}\n\n${liveCallRules(pickWaitFiller(context.conversationId, Math.random, language))}\n\n${language === "en" ? SOUND_HUMAN_EN : SOUND_HUMAN}\n\nHOW YOU SOUND: ${realtimeSettings(context.store).style}\n\n${languageReminder(language)}`;
}

/**
 * The first thing said on a call: short, fixed, and with no tools (the client sends it with
 * tool_choice "none"), so the call never opens by showing products nobody asked for.
 */
export function openerInstruction(saved: SavedDetails | null, language: ReplyLanguagePreference = "auto"): string {
  const first = saved?.name?.trim().split(/\s+/)[0];
  const line =
    language === "en"
      ? first
        ? `Hi ${first}! How can I help you today?`
        : "Hi! How can I help you today?"
      : first
        ? `হ্যালো ${first}! বলুন, কিভাবে সাহায্য করতে পারি?`
        : "হ্যালো! বলুন, আপনাকে কিভাবে সাহায্য করতে পারি?";
  return `Say exactly this, warmly, and nothing else: "${line}"`;
}

/** Our chat-completions tool schemas in the Realtime API's flat format. */
export function realtimeTools(enabledFeatures?: string | null) {
  return getLiveCallTools(enabledFeatures).map((tool) => ({
    type: "function" as const,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

export type RealtimeSessionGrant = {
  clientSecret: string;
  expiresAt: number;
  model: string;
  opener: string;
};

/** A short-lived token the browser uses to open the WebRTC call, with our instructions and tools. */
export async function createRealtimeSession(context: SessionContext): Promise<RealtimeSessionGrant> {
  const apiKey = realtimeApiKey(context.store);
  if (!apiKey) throw new RealtimeError("Realtime voice needs an OpenAI key in Admin → AI model.");
  const voice = realtimeSettings(context.store);
  const [instructions, saved] = await Promise.all([
    realtimeInstructions(context),
    savedDetailsForVisitor(context.storeId, context.visitorId).catch(() => null),
  ]);

  const response = await fetch(`${OPENAI_BASE}/realtime/client_secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: SECRET_TTL_SECONDS },
      session: {
        type: "realtime",
        model: voice.model,
        instructions,
        tools: realtimeTools(context.store.settings?.enabledFeatures),
        tool_choice: "auto",
        // Cost guards. Retention-ratio truncation drops the oldest part of a long call in one large
        // block rather than a little every turn, so the cached prefix keeps matching. The output cap
        // only stops runaway speech: replies are one sentence, and the longest normal reply (the
        // order read-back, with the phone number digit by digit) fits well within it.
        // 0.5: when a long call hits the limit, drop half at once, so later replies carry less
        // history and truncation happens less often (each truncation re-bills the prefix uncached).
        truncation: { type: "retention_ratio", retention_ratio: 0.5 },
        max_output_tokens: 600,
        audio: {
          input: {
            // Transcripts are what the chat, the inbox and the AI's memory show.
            transcription: {
              model: REALTIME_TRANSCRIBE_MODEL,
              prompt: "A customer talking to an online shop assistant in Bangla or English: products, prices, cart, order, delivery, name, phone number, address.",
            },
            noise_reduction: { type: "near_field" },
            // "low" waits until the customer has clearly finished, so fewer replies start on a pause or
            // background noise and are then interrupted (each one is a billed response).
            turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true },
          },
          output: { voice: voice.voice, speed: voice.speed },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as {
    value?: string;
    expires_at?: number;
    error?: { message?: string };
  } | null;
  if (!response.ok || !body?.value) {
    logger.error("realtime.session_failed", { status: response.status, error: body?.error?.message?.slice(0, 300) });
    const reason =
      response.status === 401
        ? "Live voice couldn't start: the OpenAI key in Admin → AI model was rejected."
        : response.status === 429
          ? "Live voice is busy or the OpenAI account is out of credit. Please try again later."
          : "Live voice could not start. Please try again.";
    throw new RealtimeError(reason, response.status);
  }
  return { clientSecret: body.value, expiresAt: body.expires_at ?? 0, model: voice.model, opener: openerInstruction(saved, storeLanguage(context.store)) };
}

/**
 * Tool output for the model, kept small like in text chat (cards carry the details on screen). On a
 * call every result stays in the context, and is billed again, until the call ends. Extras go first,
 * so the length cap can't cut them off: `nextFiller`, the filler to say at the next pause (see
 * pickWaitFiller), and `orderState` (see realtimeStateNote) when the cart or order changed.
 */
export function toolOutputForModel(
  result: ToolExecutionResult,
  orderState?: string | null,
  nextFiller?: string | null,
): string {
  const content = compactToolContent(result.content);
  const extras = { ...(nextFiller ? { nextFiller } : {}), ...(orderState ? { orderState } : {}) };
  const withExtras =
    Object.keys(extras).length > 0 && content && typeof content === "object" && !Array.isArray(content)
      ? { ...extras, ...content }
      : content;
  const serialized = JSON.stringify(withExtras);
  return serialized.length > 6_000 ? `${serialized.slice(0, 6_000)}…` : serialized;
}

/** Whether a tool's UI means the cart or order changed (so the instructions should be refreshed). */
export function changesOrderState(parts: ChatPart[] | undefined): boolean {
  return (parts ?? []).some((part) => part.type === "cart_summary" || part.type === "order_confirmation");
}

// Cards shown during a spoken reply, attached to that reply when its transcript is saved, so the
// AI's memory ("[On screen …]") includes them. In-memory: on a restart a reply is saved as text only.
const pendingParts = new Map<string, { parts: ChatPart[]; at: number }>();

export function rememberShownParts(conversationId: string, parts: ChatPart[]) {
  const now = Date.now();
  for (const [key, entry] of pendingParts) if (now - entry.at > 5 * 60_000) pendingParts.delete(key);
  const entry = pendingParts.get(conversationId) ?? { parts: [], at: now };
  entry.parts.push(...parts);
  entry.at = now;
  pendingParts.set(conversationId, entry);
}

export function takeShownParts(conversationId: string): ChatPart[] {
  const entry = pendingParts.get(conversationId);
  pendingParts.delete(conversationId);
  return entry?.parts ?? [];
}
