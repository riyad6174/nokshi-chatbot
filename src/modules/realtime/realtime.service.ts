import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { resolveAiConfig } from "@/modules/ai/config";
import { buildSystemInstructions } from "@/modules/ai/system-instructions";
import { getProviderTools } from "@/modules/ai/tools";
import type { ToolExecutionResult } from "@/modules/ai/tools/types";
import { getCartSummary } from "@/modules/cart/cart.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { savedDetailsForVisitor, type SavedDetails } from "@/modules/customers/profile.service";
import { describeOpenProposal } from "@/modules/orders/voice-order.service";
import type { StoreWithSettings } from "@/modules/stores/store.service";
import type { ChatPart } from "@/types/chat";

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

/** The OpenAI key realtime runs on: the store's AI key when the store uses OpenAI. Null otherwise. */
export function realtimeApiKey(store: Pick<StoreWithSettings, "settings">): string | null {
  const config = resolveAiConfig(store.settings);
  if (!config || config.kind !== "openai-compatible" || !config.baseUrl.startsWith(OPENAI_BASE) || !config.apiKey) return null;
  return config.apiKey;
}

/** Which voice engine this store's widget uses. Realtime needs an OpenAI key; otherwise the cascade. */
export function voiceEngine(store: Pick<StoreWithSettings, "settings">): "realtime" | "cascade" {
  return env.VOICE_ENGINE === "realtime" && realtimeApiKey(store) ? "realtime" : "cascade";
}

const LIVE_CALL_RULES = `LIVE CALL: you are on a real-time voice call. You hear the customer directly and they hear you as you speak.
- Be brief and straightforward: ONE short sentence (about 12 words), at most two when you must ask something. Then stop and let them talk. No explanations they didn't ask for, no repeating what's on screen. If they interrupt, stop and listen; never lose track of what they asked before.
- Before a tool call that takes a moment, you may say a two-word filler ("এক মিনিট…", "One sec…"), then go quiet until the result arrives.
- Phone numbers: repeat them back digit by digit once, naturally, as part of your reply.`;

// What makes a voice sound like a person rather than an AI: everyday spoken words, not written ones.
const SOUND_HUMAN = `SOUND LIKE A REAL PERSON, NOT AN AI:
- Speak everyday spoken Bangladeshi Bangla, the way a friendly shop assistant in Dhaka talks on the phone. Never formal or written Bangla.
  Natural: "আচ্ছা, দেখাচ্ছি।" · "এইটা নিবেন?" · "দাম পড়বে বারোশো টাকা।" · "ঠিক আছে, অর্ডার করে দিচ্ছি।" · "নাম্বারটা একটু বলবেন?" · "কোথায় পাঠাবো?"
  Not this: "অনুগ্রহ করে", "আপনার সুবিধার্থে", "প্রদান করুন", "আপনি কি ইচ্ছুক", "নিশ্চিত করুন", "আমি আপনাকে সহায়তা করতে পারি".
- Use the English words Bangladeshis actually say: অর্ডার, ডেলিভারি, কনফার্ম, প্রোডাক্ট, সাইজ, কালার, ক্যাশ অন ডেলিভারি, ফোন নাম্বার.
- React like a person before answering when it fits: "আচ্ছা", "জি", "হুম", "ওহ, দারুণ!", "আরে বাহ", "ঠিক আছে". Vary them; skip them in plain answers.
- Say prices the spoken way: "বারোশো টাকা", "সাড়ে চার হাজার টাকা", not digits read one by one.
- In English, sound casual and warm too: contractions ("it's", "you'll"), "Sure!", "Got it", "Nice pick!".
- Vary your rhythm: short replies, natural pauses ("হুম… এইটা ভালো হবে"), a smile in your voice. Never read like a script.`;

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
  });
  return `${base}\n\n${LIVE_CALL_RULES}\n\n${SOUND_HUMAN}\n\nHOW YOU SOUND: ${env.REALTIME_VOICE_STYLE}`;
}

/** What the assistant says first when the call connects. */
/**
 * The first thing said on a call: short, fixed, and with no tools (the client sends it with
 * tool_choice "none"), so the call never opens by showing products nobody asked for.
 */
export function openerInstruction(saved: SavedDetails | null): string {
  const first = saved?.name?.trim().split(/\s+/)[0];
  const line = first ? `হ্যালো ${first}, আমি শুনছি।` : "হ্যালো, আমি শুনছি।";
  return `Say exactly this, warmly, and nothing else: "${line}"`;
}

/** Our chat-completions tool schemas in the Realtime API's flat format. */
export function realtimeTools() {
  return getProviderTools().map((tool) => ({
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
        model: env.REALTIME_MODEL,
        instructions,
        tools: realtimeTools(),
        tool_choice: "auto",
        audio: {
          input: {
            // Transcripts are what the chat, the inbox and the AI's memory show.
            transcription: { model: "gpt-4o-mini-transcribe" },
            noise_reduction: { type: "near_field" },
            turn_detection: { type: "semantic_vad", eagerness: "high", create_response: true, interrupt_response: true },
          },
          output: { voice: env.REALTIME_VOICE, speed: env.REALTIME_VOICE_SPEED },
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
  return { clientSecret: body.value, expiresAt: body.expires_at ?? 0, model: env.REALTIME_MODEL, opener: openerInstruction(saved) };
}

/** Tool output for the model: the tool's content, kept small (cards carry the details on screen). */
export function toolOutputForModel(result: ToolExecutionResult): string {
  const serialized = JSON.stringify(result.content);
  return serialized.length > 8_000 ? `${serialized.slice(0, 8_000)}…` : serialized;
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
