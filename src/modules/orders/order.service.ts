import { randomInt } from "node:crypto";
import type { CustomerDetails, Order, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { phoneDigits } from "@/lib/digits";
import { logger } from "@/lib/logging/logger";
import type { CheckoutLineSnapshot } from "@/modules/commerce/commerce-adapter";
import { variantPriceMinor } from "@/modules/catalog/product.service";
import { trackEvent } from "@/modules/customers/events.service";
import { recordOrderOnProfile } from "@/modules/customers/profile.service";
import type { OrderStatusData } from "@/types/chat";

// Interactive transactions default to a 5 s limit, which a slow Atlas round-trip can exceed.
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export class OrderError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "OrderError";
    this.code = code;
    this.details = details;
  }
}

export const ORDER_STATUSES = ["placed", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<string, string> = {
  placed: "Order placed",
  confirmed: "Confirmed",
  processing: "Being packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

// Which status changes an admin may make. Cancelled/refunded are terminal.
const TRANSITIONS: Record<string, OrderStatus[]> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function allowedNextStatuses(status: string): OrderStatus[] {
  return TRANSITIONS[status] ?? [];
}

export type ShippingZone = { id: string; label: string; feeMinor: number };

export function parseShippingZones(value: string | null | undefined): ShippingZone[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (zone): zone is ShippingZone =>
          typeof zone?.id === "string" && typeof zone?.label === "string" && Number.isInteger(zone?.feeMinor) && zone.feeMinor >= 0,
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function shippingFor(
  store: { shippingZones: string; freeShippingOverMinor: number | null },
  zoneId: string,
  subtotalMinor: number,
): { zone: ShippingZone | null; feeMinor: number } {
  const zones = parseShippingZones(store.shippingZones);
  if (zones.length === 0) return { zone: null, feeMinor: 0 };
  const zone = zones.find((entry) => entry.id === zoneId) ?? null;
  if (!zone) throw new OrderError("invalid_zone", "Choose a delivery area.");
  const free = store.freeShippingOverMinor != null && subtotalMinor >= store.freeShippingOverMinor;
  return { zone, feeMinor: free ? 0 : zone.feeMinor };
}

/** Digits only; compares the last 10 so "+880 1712-345678" matches "01712345678". */
export function normalizePhone(phone: string): string {
  return phoneDigits(phone).slice(-10);
}

const ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateOrderNumber(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += ORDER_ALPHABET[randomInt(ORDER_ALPHABET.length)];
  return `NB-${code}`;
}

function parseLines(value: string): CheckoutLineSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as CheckoutLineSnapshot[]) : [];
  } catch {
    return [];
  }
}

export type PlaceOrderInput = {
  token: string;
  customer: CustomerDetails;
  shippingZoneId: string;
  paymentMethod: "cod" | "online";
};

/**
 * Turns a prepared checkout into an order. Re-checks every line against the live catalog: if a price
 * changed since the customer reviewed it, the order is refused so they can confirm the new total.
 * Stock is reserved with conditional decrements inside one transaction, so two buyers can't both take the last unit.
 */
export async function placeOrderFromCheckout(input: PlaceOrderInput): Promise<Order> {
  const checkout = await prisma.checkoutSession.findUnique({
    where: { token: input.token },
    include: { store: true, cart: true },
  });
  if (!checkout) throw new OrderError("checkout_not_found", "This checkout link is not valid.");
  if (checkout.status === "completed" && checkout.orderId) {
    const existing = await prisma.order.findUnique({ where: { id: checkout.orderId } });
    if (existing) return existing; // Double submit: return the order already placed.
  }
  if (checkout.status !== "prepared") throw new OrderError("checkout_closed", "This checkout is no longer open.");
  if (checkout.expiresAt && checkout.expiresAt < new Date()) {
    await prisma.checkoutSession.update({ where: { id: checkout.id }, data: { status: "expired" } });
    throw new OrderError("checkout_expired", "This checkout link expired. Start checkout again from the chat.");
  }

  const store = checkout.store;
  if (input.paymentMethod === "cod" && !store.codEnabled) {
    throw new OrderError("payment_unavailable", "Cash on delivery isn't available for this store.");
  }
  if (input.paymentMethod === "online") {
    // No payment gateway is connected yet; never record an order as paid without one.
    throw new OrderError("payment_unavailable", "Online payment isn't connected yet. Please choose cash on delivery.");
  }

  const lines = parseLines(checkout.lines);
  if (lines.length === 0) throw new OrderError("empty", "This checkout has no items.");

  // Live revalidation against the catalog.
  const products = await prisma.product.findMany({
    where: { storeId: store.id, id: { in: [...new Set(lines.map((line) => line.productId))] } },
    include: { variants: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const issues: Array<{ name: string; reason: string }> = [];
  for (const line of lines) {
    const product = byId.get(line.productId);
    const variant = line.variantId ? product?.variants.find((entry) => entry.id === line.variantId) : null;
    if (!product || product.status !== "active" || (line.variantId && !variant)) {
      issues.push({ name: line.name, reason: "no longer available" });
      continue;
    }
    if (variantPriceMinor(product, variant) !== line.unitPriceMinor) {
      issues.push({ name: line.name, reason: "price changed" });
    }
  }
  if (issues.length > 0) {
    await prisma.checkoutSession.update({ where: { id: checkout.id }, data: { status: "expired" } });
    throw new OrderError("cart_changed", "Some items changed since you reviewed them. Please check your cart again.", issues);
  }

  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const shipping = shippingFor(store, input.shippingZoneId, subtotalMinor);
  const now = new Date();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const order = await prisma.$transaction(async (tx) => {
        for (const line of lines) {
          if (!line.variantId) continue;
          const variant = byId.get(line.productId)?.variants.find((entry) => entry.id === line.variantId);
          if (variant?.stockStatus === "out_of_stock") {
            throw new OrderError("out_of_stock", `${line.name} is out of stock.`);
          }
          if (variant?.stockQuantity == null) continue; // Stock isn't tracked for this variant.
          const reserved = await tx.productVariant.updateMany({
            where: { id: line.variantId, stockQuantity: { gte: line.quantity } },
            data: { stockQuantity: { decrement: line.quantity } },
          });
          if (reserved.count === 0) {
            throw new OrderError("out_of_stock", `Not enough stock left for ${line.name}${line.variantTitle ? ` (${line.variantTitle})` : ""}.`);
          }
        }

        const created = await tx.order.create({
          data: {
            storeId: store.id,
            orderNumber: generateOrderNumber(),
            checkoutSessionId: checkout.id,
            sessionId: checkout.cart.sessionId,
            customer: input.customer,
            items: lines.map((line) => ({
              productId: line.productId,
              variantId: line.variantId,
              name: line.name,
              variantTitle: line.variantTitle,
              sku: line.sku,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              lineTotalMinor: line.lineTotalMinor,
            })),
            subtotalMinor,
            shippingMinor: shipping.feeMinor,
            totalMinor: subtotalMinor + shipping.feeMinor,
            currency: checkout.currency,
            shippingZone: shipping.zone?.label ?? "",
            paymentMethod: input.paymentMethod,
            paymentStatus: "pending",
            status: "placed",
            statusHistory: [{ status: "placed", note: "", at: now, by: "customer" }],
          },
        });

        await tx.checkoutSession.update({
          where: { id: checkout.id },
          data: { status: "completed", completedAt: now, orderId: created.id, customer: input.customer },
        });
        await tx.cart.update({ where: { id: checkout.cartId }, data: { status: "checked_out" } });
        await tx.checkoutSession.updateMany({
          where: { cartId: checkout.cartId, status: "prepared", id: { not: checkout.id } },
          data: { status: "expired" },
        });
        return created;
      }, TX_OPTIONS);

      logger.info("order.placed", { storeId: store.id, orderId: order.id, totalMinor: order.totalMinor, lines: lines.length });
      await announceInChat(order);
      await recordOrderOnProfile(order);
      if (order.sessionId) {
        await trackEvent({
          storeId: store.id,
          sessionId: order.sessionId,
          type: "order_placed",
          orderId: order.id,
          cartId: checkout.cartId,
          valueMinor: order.totalMinor,
        });
      }
      return order;
    } catch (error) {
      // Order-number collision: retry with a new number. Everything else propagates.
      const isCollision =
        typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
      if (!isCollision || attempt === 2) throw error;
    }
  }
  throw new OrderError("order_failed", "The order could not be placed. Please try again.");
}

/** Posts an event in the customer's chat so the conversation (and the AI) knows an order exists. */
async function announceInChat(order: Order) {
  if (!order.sessionId) return;
  const conversation = await prisma.conversation.findFirst({
    where: { sessionId: order.sessionId, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) return;
  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "event",
        content: `Order ${order.orderNumber} placed. Payment: ${order.paymentMethod === "cod" ? "cash on delivery" : "online"}.`,
        structuredContent: JSON.stringify([{ type: "order_status", orders: [toOrderStatusData(order)] }]),
      },
    }),
    prisma.order.update({ where: { id: order.id }, data: { conversationId: conversation.id } }),
  ]);
}

export function toOrderStatusData(order: Order): OrderStatusData {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status] ?? order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    totalMinor: order.totalMinor,
    currency: order.currency,
    placedAt: order.createdAt.toISOString(),
    trackingNumber: order.trackingNumber,
    items: order.items.map((item) => ({
      name: item.name,
      variantTitle: item.variantTitle ?? null,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor,
    })),
    history: order.statusHistory.map((event) => ({
      status: event.status,
      label: STATUS_LABELS[event.status] ?? event.status,
      at: event.at.toISOString(),
      note: event.note,
    })),
  };
}

/**
 * Order lookup for the chat. Orders placed from this chat session are visible without extra checks;
 * any other order needs its number plus the phone number it was placed with.
 */
export async function findOrdersForCustomer(input: {
  storeId: string;
  sessionId: string;
  orderNumber?: string;
  phone?: string;
}): Promise<{ orders: Order[]; verified: boolean }> {
  const orderNumber = input.orderNumber?.trim().toUpperCase();
  if (orderNumber) {
    const order = await prisma.order.findFirst({ where: { storeId: input.storeId, orderNumber } });
    if (!order) return { orders: [], verified: false };
    if (order.sessionId === input.sessionId) return { orders: [order], verified: true };
    const phoneMatches = input.phone && normalizePhone(input.phone) === normalizePhone(order.customer.phone);
    return phoneMatches ? { orders: [order], verified: true } : { orders: [], verified: false };
  }
  const orders = await prisma.order.findMany({
    where: { storeId: input.storeId, sessionId: input.sessionId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return { orders, verified: true };
}

export async function listOrdersForAdmin(storeId: string, status?: string, take = 100) {
  return prisma.order.findMany({
    where: { storeId, ...(status && status !== "all" ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function getOrderForAdmin(storeId: string, orderId: string) {
  if (!isObjectId(orderId)) return null;
  return prisma.order.findFirst({ where: { id: orderId, storeId } });
}

/** Admin status change. Cancelling releases reserved stock back to the variants. */
export async function updateOrderStatus(input: {
  storeId: string;
  orderId: string;
  status: OrderStatus;
  note?: string;
  trackingNumber?: string;
  by: string;
}) {
  const order = await getOrderForAdmin(input.storeId, input.orderId);
  if (!order) throw new OrderError("not_found", "Order not found.");
  if (!allowedNextStatuses(order.status).includes(input.status)) {
    throw new OrderError("invalid_transition", `An order that is "${order.status}" can't become "${input.status}".`);
  }

  const event = { status: input.status, note: input.note?.trim() ?? "", at: new Date(), by: input.by };
  const data: Prisma.OrderUpdateInput = {
    status: input.status,
    statusHistory: { push: event },
    ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber.trim() } : {}),
    ...(input.status === "delivered" && order.paymentMethod === "cod" ? { paymentStatus: "paid" } : {}),
    ...(input.status === "refunded" ? { paymentStatus: "refunded" } : {}),
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (input.status === "cancelled") {
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.productVariant.updateMany({
          where: { id: item.variantId, stockQuantity: { not: null } },
          data: { stockQuantity: { increment: item.quantity } },
        });
      }
    }
    return tx.order.update({ where: { id: order.id }, data });
  }, TX_OPTIONS);

  logger.info("order.status_changed", { orderId: order.id, from: order.status, to: input.status, by: input.by });

  if (updated.conversationId) {
    await prisma.message.create({
      data: {
        conversationId: updated.conversationId,
        role: "event",
        content: `Order ${updated.orderNumber}: ${STATUS_LABELS[input.status] ?? input.status}${event.note ? `. ${event.note}` : ""}`,
        structuredContent: JSON.stringify([{ type: "order_status", orders: [toOrderStatusData(updated)] }]),
      },
    });
  }
  return updated;
}
