import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { getStoreByWidgetKey, parseJsonArray, type StoreWithSettings } from "@/modules/stores/store.service";

// Interactive transactions default to a 5 s limit, which a slow Atlas round-trip can exceed.
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export type SessionContext = {
  sessionId: string;
  storeId: string;
  conversationId: string;
  cartId: string;
  locale: string;
  visitorId: string;
  store: StoreWithSettings;
};

function resolveLocale(store: StoreWithSettings, requested?: string | null): string {
  const supported = parseJsonArray(store.supportedLocales);
  if (requested && supported.includes(requested)) return requested;
  if (supported.includes(store.defaultLocale)) return store.defaultLocale;
  return supported[0] || store.defaultLocale || "en";
}

export async function createSession(input: {
  widgetKey: string;
  visitorId?: string | null;
  locale?: string;
}): Promise<SessionContext | null> {
  const store = await getStoreByWidgetKey(input.widgetKey);
  if (!store) return null;

  const locale = resolveLocale(store, input.locale);
  const visitorId = input.visitorId?.trim() || randomUUID();

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.chatSession.create({
      data: { storeId: store.id, visitorId, locale },
    });
    const conversation = await tx.conversation.create({
      data: { storeId: store.id, sessionId: created.id, status: "bot" },
    });
    const cart = await tx.cart.create({
      data: { storeId: store.id, sessionId: created.id, status: "active", currency: store.currency },
    });
    return { created, conversation, cart };
  }, TX_OPTIONS);

  return {
    sessionId: session.created.id,
    storeId: store.id,
    conversationId: session.conversation.id,
    cartId: session.cart.id,
    locale,
    visitorId,
    store,
  };
}

export async function getSessionContext(sessionId: string): Promise<SessionContext | null> {
  if (!isObjectId(sessionId)) return null;
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      store: { include: { settings: true } },
      conversations: { where: { status: { not: "closed" } }, orderBy: { createdAt: "desc" }, take: 1 },
      carts: { where: { status: "active" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!session) return null;

  let conversation = session.conversations[0];
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { storeId: session.storeId, sessionId: session.id, status: "bot" },
    });
  }

  let cart = session.carts[0];
  if (!cart) {
    cart = await prisma.cart.create({
      data: { storeId: session.storeId, sessionId: session.id, status: "active", currency: session.store.currency },
    });
  }

  return {
    sessionId: session.id,
    storeId: session.storeId,
    conversationId: conversation.id,
    cartId: cart.id,
    locale: session.locale,
    visitorId: session.visitorId,
    store: session.store,
  };
}

export async function touchSession(sessionId: string, locale?: string) {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date(), ...(locale ? { locale } : {}) },
  });
}

export function resolveLocaleForStore(store: StoreWithSettings, requested?: string | null): string {
  return resolveLocale(store, requested);
}
