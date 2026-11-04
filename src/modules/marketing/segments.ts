import type { CustomerProfile, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { canMarket, type MarketingChannel } from "@/modules/marketing/consent";

// Customer segments for campaigns: simple, explainable rules over customer profiles and events.

export const segmentSchema = z
  .object({
    minOrders: z.number().int().min(0).max(10_000).optional(),
    maxOrders: z.number().int().min(0).max(10_000).optional(),
    spentAtLeastMinor: z.number().int().min(0).optional(),
    /** Seen on the site in the last N days. */
    seenWithinDays: z.number().int().min(1).max(3650).optional(),
    /** Not seen for at least N days (win-back). */
    inactiveForDays: z.number().int().min(1).max(3650).optional(),
    interestsAny: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    /** Viewed or added any of these categories in the last 30 days. */
    categoriesAny: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  })
  .strict();
export type Segment = z.infer<typeof segmentSchema>;

export function parseSegment(value: string | null | undefined): Segment {
  try {
    const parsed = segmentSchema.safeParse(JSON.parse(value || "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function profileWhere(storeId: string, segment: Segment, now: Date): Prisma.CustomerProfileWhereInput {
  const day = 24 * 60 * 60 * 1000;
  return {
    storeId,
    ...(segment.minOrders != null || segment.maxOrders != null
      ? { orderCount: { ...(segment.minOrders != null ? { gte: segment.minOrders } : {}), ...(segment.maxOrders != null ? { lte: segment.maxOrders } : {}) } }
      : {}),
    ...(segment.spentAtLeastMinor != null ? { totalSpentMinor: { gte: segment.spentAtLeastMinor } } : {}),
    ...(segment.seenWithinDays != null || segment.inactiveForDays != null
      ? {
          lastSeenAt: {
            ...(segment.seenWithinDays != null ? { gte: new Date(now.getTime() - segment.seenWithinDays * day) } : {}),
            ...(segment.inactiveForDays != null ? { lte: new Date(now.getTime() - segment.inactiveForDays * day) } : {}),
          },
        }
      : {}),
  };
}

/** Profiles in the segment (consent is checked separately, per channel). */
export async function segmentProfiles(storeId: string, segment: Segment, now = new Date()): Promise<CustomerProfile[]> {
  let profiles = await prisma.customerProfile.findMany({ where: profileWhere(storeId, segment, now), take: 20_000 });
  if (segment.interestsAny?.length) {
    const wanted = segment.interestsAny.map((value) => value.toLowerCase());
    profiles = profiles.filter((profile) => profile.interests.some((interest) => wanted.some((value) => interest.toLowerCase().includes(value))));
  }
  if (segment.categoriesAny?.length && profiles.length > 0) {
    const wanted = new Set(segment.categoriesAny.map((value) => value.toLowerCase()));
    const products = await prisma.product.findMany({ where: { storeId }, select: { id: true, category: true } });
    const productIds = products.filter((product) => wanted.has(product.category.toLowerCase())).map((product) => product.id);
    const events = await prisma.customerEvent.findMany({
      where: { storeId, type: { in: ["viewed_product", "added_to_cart"] }, productId: { in: productIds }, at: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      select: { profileId: true, visitorId: true },
    });
    const profileIds = new Set(events.map((event) => event.profileId).filter(Boolean));
    const visitorIds = new Set(events.map((event) => event.visitorId));
    profiles = profiles.filter((profile) => profileIds.has(profile.id) || profile.visitorIds.some((visitor) => visitorIds.has(visitor)));
  }
  return profiles;
}

/** How many customers match, and how many of them can actually be messaged on this channel. */
export async function previewSegment(storeId: string, segment: Segment, channel: MarketingChannel) {
  const profiles = await segmentProfiles(storeId, segment);
  const reachable = profiles.filter((profile) => canMarket(profile, channel).ok).length;
  return { matched: profiles.length, reachable };
}
