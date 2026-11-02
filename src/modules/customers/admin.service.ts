import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";

export const CUSTOMER_FILTERS = ["all", "opted_in", "buyers", "abandoned"] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

const ABANDONED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function abandonedProfileIds(storeId: string): Promise<string[]> {
  const events = await prisma.customerEvent.findMany({
    where: { storeId, type: "abandoned_cart", profileId: { not: null }, at: { gte: new Date(Date.now() - ABANDONED_WINDOW_MS) } },
    select: { profileId: true },
    distinct: ["profileId"],
    take: 1000,
  });
  return events.map((event) => event.profileId!).filter(Boolean);
}

export async function listCustomersForAdmin(storeId: string, filter: CustomerFilter = "all", query = "", take = 200) {
  const where: Prisma.CustomerProfileWhereInput = { storeId };
  if (filter === "opted_in") where.marketingConsent = { is: { granted: true } };
  if (filter === "buyers") where.orderCount = { gt: 0 };
  if (filter === "abandoned") where.id = { in: await abandonedProfileIds(storeId) };
  const q = query.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
      { interests: { has: q } },
    ];
  }
  return prisma.customerProfile.findMany({ where, orderBy: { lastSeenAt: "desc" }, take });
}

export async function countCustomers(storeId: string) {
  const [all, optedIn, buyers, abandoned] = await Promise.all([
    prisma.customerProfile.count({ where: { storeId } }),
    prisma.customerProfile.count({ where: { storeId, marketingConsent: { is: { granted: true } } } }),
    prisma.customerProfile.count({ where: { storeId, orderCount: { gt: 0 } } }),
    abandonedProfileIds(storeId).then((ids) => ids.length),
  ]);
  return { all, opted_in: optedIn, buyers, abandoned };
}

export async function getCustomerForAdmin(storeId: string, profileId: string) {
  if (!isObjectId(profileId)) return null;
  const profile = await prisma.customerProfile.findFirst({ where: { id: profileId, storeId } });
  if (!profile) return null;

  const sessions = await prisma.chatSession.findMany({
    where: { storeId, visitorId: { in: profile.visitorIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);
  const [events, orders, conversations] = await Promise.all([
    prisma.customerEvent.findMany({
      where: { storeId, OR: [{ profileId: profile.id }, { visitorId: { in: profile.visitorIds } }] },
      orderBy: { at: "desc" },
      take: 100,
    }),
    prisma.order.findMany({ where: { storeId, sessionId: { in: sessionIds } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.conversation.findMany({
      where: { storeId, sessionId: { in: sessionIds } },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, status: true, lastMessageAt: true },
      take: 20,
    }),
  ]);

  const productIds = [...new Set(events.map((event) => event.productId).filter((id): id is string => Boolean(id && isObjectId(id))))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
  const productNames = new Map(products.map((product) => [product.id, product.name]));

  return { profile, events, orders, conversations, productNames };
}

/** Customers who agreed to marketing, for export. Never includes anyone without recorded consent. */
export async function listOptedInCustomers(storeId: string) {
  return prisma.customerProfile.findMany({
    where: { storeId, marketingConsent: { is: { granted: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: 10_000,
  });
}
