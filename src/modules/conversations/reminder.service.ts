import { prisma } from "@/lib/db/prisma";
import { getCartSummary } from "@/modules/cart/cart.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { savedDetailsForVisitor } from "@/modules/customers/profile.service";
import { findOpenProposal } from "@/modules/orders/voice-order.service";
import type { SpeechLang } from "@/modules/speech/speech-provider";
import type { ChatPart } from "@/types/chat";

// What a returning visitor left unfinished, so the welcome bubble can pick up where they stopped
// instead of greeting them like a stranger.

export type ReminderKind = "open_order" | "cart" | "product" | "recent_order" | "conversation";

export type Reminder = {
  kind: ReminderKind;
  text: string;
  product: { name: string; imageUrl: string | null } | null;
};

const RECENT_ORDER_MS = 7 * 24 * 60 * 60 * 1000;
const PRODUCT_INTEREST_MS = 14 * 24 * 60 * 60 * 1000;

function welcomeBack(lang: SpeechLang, name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (lang === "bn") return first ? `আবার স্বাগতম, ${first}!` : "আবার স্বাগতম!";
  return first ? `Welcome back, ${first}!` : "Welcome back!";
}

/** The most useful reminder for this visitor, or null for a first visit with nothing to resume. */
export async function buildReminder(context: SessionContext, lang: SpeechLang): Promise<Reminder | null> {
  const [saved, openOrder, cart, lastOrder, messages] = await Promise.all([
    savedDetailsForVisitor(context.storeId, context.visitorId).catch(() => null),
    findOpenProposal(context).catch(() => null),
    getCartSummary(context.sessionId, context.storeId, context.store.currency),
    prisma.order.findFirst({ where: { sessionId: context.sessionId }, orderBy: { createdAt: "desc" } }),
    prisma.message.findMany({
      where: { conversationId: context.conversationId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { role: true, structuredContent: true, createdAt: true },
    }),
  ]);
  const hello = welcomeBack(lang, saved?.name ?? "");

  if (openOrder && cart.items.length > 0) {
    return {
      kind: "open_order",
      text:
        lang === "bn"
          ? `${hello} আপনার অর্ডারটি কনফার্মের অপেক্ষায় আছে। এখনই শেষ করবেন?`
          : `${hello} Your order is ready to confirm. Shall we finish it now?`,
      product: cart.items[0] ? { name: cart.items[0].name, imageUrl: cart.items[0].imageUrl } : null,
    };
  }

  if (cart.items.length > 0) {
    const first = cart.items[0]!;
    const more = cart.items.length - 1;
    const items =
      lang === "bn"
        ? `${first.name}${more > 0 ? ` সহ আরও ${more}টি পণ্য` : ""}`
        : `${first.name}${more > 0 ? ` and ${more} more` : ""}`;
    return {
      kind: "cart",
      text:
        lang === "bn"
          ? `${hello} আপনার কার্টে ${items} রয়ে গেছে। অর্ডারটি শেষ করবেন?`
          : `${hello} ${items} ${more > 0 ? "are" : "is"} still in your cart. Shall we finish your order?`,
      product: { name: first.name, imageUrl: first.imageUrl },
    };
  }

  if (lastOrder && Date.now() - lastOrder.createdAt.getTime() < RECENT_ORDER_MS) {
    return {
      kind: "recent_order",
      text:
        lang === "bn"
          ? `${hello} আপনার অর্ডার ${lastOrder.orderNumber} প্রসেস হচ্ছে। আর কিছু লাগবে?`
          : `${hello} Your order ${lastOrder.orderNumber} is on its way. Need anything else?`,
      product: null,
    };
  }

  // The last product the assistant showed them, if they never added or ordered it.
  for (const message of messages) {
    if (message.role !== "assistant" || !message.structuredContent) continue;
    if (Date.now() - message.createdAt.getTime() > PRODUCT_INTEREST_MS) break;
    let parts: ChatPart[] = [];
    try {
      parts = JSON.parse(message.structuredContent) as ChatPart[];
    } catch {
      continue;
    }
    const list = parts.find((part): part is Extract<ChatPart, { type: "product_list" }> => part.type === "product_list");
    const product = list?.products[0];
    if (!product) continue;
    return {
      kind: "product",
      text:
        lang === "bn"
          ? `${hello} ${product.name} নিয়ে এখনও ভাবছেন? চাইলে এখনই অর্ডার করে দিতে পারি।`
          : `${hello} Still thinking about the ${product.name}? I can order it for you right now.`,
      product: { name: product.name, imageUrl: product.imageUrl },
    };
  }

  if (messages.some((message) => message.role === "user")) {
    return {
      kind: "conversation",
      text: lang === "bn" ? `${hello} আগের কথা থেকে চালিয়ে যাবেন?` : `${hello} Shall we continue where we left off?`,
      product: null,
    };
  }
  return null;
}
