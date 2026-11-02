import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { formatMinor } from "@/lib/money";
import { getProductById } from "@/modules/catalog/product.service";
import { trackEvent } from "@/modules/customers/events.service";
import { appendMessage } from "@/modules/conversations/conversation.service";
import type { SessionContext } from "@/modules/conversations/session.service";
import { parseJsonObject } from "@/modules/stores/store.service";

const DEFAULT_PRODUCT_GREETING = "Hi! I see you're looking at {product}. Here's a quick overview. Ask me anything about it.";

/**
 * When the chat opens from a product page, send a greeting plus a factual overview built from the
 * catalog (no model call, so it appears instantly and can't invent details). Sent once per product
 * per conversation, so revisiting the page doesn't repeat it.
 */
export async function ensureProductGreeting(context: SessionContext, productId: string | undefined) {
  if (!productId || !isObjectId(productId)) return false;

  const conversation = await prisma.conversation.findUnique({
    where: { id: context.conversationId },
    select: { contextProductId: true, status: true },
  });
  if (!conversation || conversation.contextProductId === productId || conversation.status === "closed") return false;

  const product = await getProductById(context.storeId, productId);
  if (!product) return false;

  const productRow = await prisma.product.findUnique({ where: { id: productId }, select: { attributes: true, brand: true } });
  const attributes = Object.entries(parseJsonObject(productRow?.attributes))
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${String(value)}`);

  const template = context.store.settings?.productGreeting?.trim() || DEFAULT_PRODUCT_GREETING;
  const greeting = template.replaceAll("{product}", product.name);
  const available = product.variants.filter((variant) => variant.available).map((variant) => variant.title);
  const overview = [
    `${product.name}${productRow?.brand ? ` by ${productRow.brand}` : ""}: ${product.description.split(/(?<=[.!?])\s/)[0] ?? ""}`,
    `Price: ${product.variants.length > 1 ? "from " : ""}${formatMinor(product.priceMinor, product.currency)}`,
    available.length > 0 ? `Available in: ${available.join(", ")}` : "Currently out of stock.",
    ...(attributes.length > 0 ? [`Details: ${attributes.join(" · ")}`] : []),
  ].join("\n");

  await appendMessage({
    conversationId: context.conversationId,
    role: "assistant",
    content: `${greeting}\n\n${overview}`,
    parts: [
      { type: "text", text: greeting },
      { type: "text", text: overview },
      { type: "product_list", products: [product], label: "You're looking at" },
    ],
  });
  await prisma.conversation.update({ where: { id: context.conversationId }, data: { contextProductId: productId } });
  await trackEvent({
    storeId: context.storeId,
    sessionId: context.sessionId,
    visitorId: context.visitorId,
    type: "viewed_product",
    productId,
    meta: { source: "product_page" },
  });
  return true;
}
