import type { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logging/logger";
import { rateLimit } from "@/lib/rate-limit";
import { jsonError, jsonOk, readJson, validationError } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { getCartSummary } from "@/modules/cart/cart.service";
import { CheckoutError } from "@/modules/commerce/checkout.service";
import { appendMessage, listConversationMessages } from "@/modules/conversations/conversation.service";
import { getSessionContext } from "@/modules/conversations/session.service";
import { OrderError } from "@/modules/orders/order.service";
import { confirmProposedOrder } from "@/modules/orders/voice-order.service";
import { synthesizeCached } from "@/modules/speech/greeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  confirmationId: z.string().trim().min(8).max(200),
  // Voice mode: also return the spoken confirmation.
  voice: z.boolean().default(false),
  lang: z.enum(["en", "bn"]).default("en"),
});

function spokenAmount(minor: number, currency: string, lang: "en" | "bn"): string {
  const amount = (minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (currency === "BDT") return lang === "bn" ? `${amount} টাকা` : `${amount} taka`;
  return `${amount} ${currency}`;
}

/** The customer tapped Confirm on an order summary card: place the cash-on-delivery order. */
export async function POST(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const rate = await rateLimit(`order-confirm:${sessionId}`, 10, 60_000);
  if (!rate.allowed) return jsonError(429, "rate_limited", "Please wait a moment and try again.");

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error);

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired. Please reload the chat.");

  const before = new Date();
  try {
    const order = await confirmProposedOrder({ session: context, confirmationId: parsed.data.confirmationId });
    const { lang } = parsed.data;
    const amount = spokenAmount(order.totalMinor, order.currency, lang);
    const text =
      lang === "bn"
        ? `আপনার অর্ডার ${order.orderNumber} কনফার্ম হয়েছে। ডেলিভারির সময় ${amount} পরিশোধ করবেন। আর কিছু লাগবে?`
        : `Done! Your order ${order.orderNumber} is placed. You'll pay ${amount} on delivery. Is there anything else I can help with?`;
    // The AI only sees user/assistant messages, so record the confirmation where it will see it.
    await appendMessage({ conversationId: context.conversationId, role: "assistant", content: text });

    const [messages, cart, audio] = await Promise.all([
      listConversationMessages(context.conversationId, { after: before }),
      getCartSummary(context.sessionId, context.storeId, context.store.currency),
      parsed.data.voice ? synthesizeCached(text, lang) : Promise.resolve(null),
    ]);
    return jsonOk({
      orderNumber: order.orderNumber,
      messages,
      cart,
      speech: parsed.data.voice ? { text, lang, audio, mime: audio ? "audio/mpeg" : null } : null,
    });
  } catch (error) {
    if (error instanceof OrderError || error instanceof CheckoutError) {
      return jsonError(409, error.code, error.message, error.details);
    }
    logger.error("order.confirm_failed", { error: error instanceof Error ? error.message : String(error) });
    return jsonError(500, "order_failed", "The order could not be placed. Nothing was charged. Please try again.");
  }
}
