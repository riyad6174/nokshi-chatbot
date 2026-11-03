import { findPhoneNumber } from "@/lib/digits";
import type { CustomerProfile, MarketingConsent, Order } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { normalizePhone } from "@/modules/orders/order.service";

// Customer profiles for follow-up marketing. A profile starts anonymous (linked by the chat visitor
// id) and is merged into the existing profile for the same phone number once the customer gives it.

/** The exact question the assistant must ask before marketing consent is recorded. */
export const CONSENT_QUESTION =
  "Would you like us to send you offers and new arrivals by SMS, WhatsApp or email? You can stop any time.";

export type ProfilePatch = {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  deliveryAreaId?: string;
  preferredLocale?: string;
  interests?: string[];
  budgetHint?: string;
};

export type ConsentInput = {
  granted: boolean;
  channels: string[];
  source: "voice" | "chat" | "checkout";
  evidence: string;
};

type SessionRef = { storeId: string; visitorId: string };

const MAX_INTERESTS = 20;

function mergeInterests(current: string[], extra: string[] | undefined): string[] {
  if (!extra || extra.length === 0) return current;
  const seen = new Set(current.map((value) => value.toLowerCase()));
  const merged = [...current];
  for (const value of extra.map((entry) => entry.trim()).filter(Boolean)) {
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    merged.push(value.slice(0, 60));
  }
  return merged.slice(-MAX_INTERESTS);
}

export async function findProfileForVisitor(storeId: string, visitorId: string): Promise<CustomerProfile | null> {
  return prisma.customerProfile.findFirst({ where: { storeId, visitorIds: { has: visitorId } }, orderBy: { lastSeenAt: "desc" } });
}

/**
 * Creates or updates the profile for this visitor. When a phone number arrives that already belongs to
 * another profile, the two are merged into the phone one.
 */
export async function upsertProfile(
  session: SessionRef,
  patch: ProfilePatch,
  consent?: ConsentInput,
): Promise<CustomerProfile> {
  const phoneKey = patch.phone ? normalizePhone(patch.phone) : "";
  let profile = await findProfileForVisitor(session.storeId, session.visitorId);

  if (phoneKey) {
    const byPhone = await prisma.customerProfile.findFirst({ where: { storeId: session.storeId, phoneKey } });
    if (byPhone && profile && byPhone.id !== profile.id) {
      // Fold the anonymous profile into the known customer.
      const anonymous = profile;
      await prisma.customerEvent.updateMany({ where: { profileId: anonymous.id }, data: { profileId: byPhone.id } });
      await prisma.customerProfile.delete({ where: { id: anonymous.id } });
      profile = await prisma.customerProfile.update({
        where: { id: byPhone.id },
        data: {
          visitorIds: [...new Set([...byPhone.visitorIds, ...anonymous.visitorIds])],
          interests: mergeInterests(byPhone.interests, anonymous.interests),
          budgetHint: byPhone.budgetHint || anonymous.budgetHint,
          email: byPhone.email || anonymous.email,
          address: byPhone.address || anonymous.address,
          city: byPhone.city || anonymous.city,
          deliveryAreaId: byPhone.deliveryAreaId || anonymous.deliveryAreaId,
          marketingConsent: byPhone.marketingConsent ?? anonymous.marketingConsent ?? undefined,
        },
      });
    } else if (byPhone) {
      profile = byPhone;
    }
  }

  const consentRecord: MarketingConsent | undefined = consent
    ? {
        granted: consent.granted,
        channels: consent.granted ? consent.channels : [],
        at: new Date(),
        source: consent.source,
        wording: CONSENT_QUESTION,
        evidence: consent.evidence.slice(0, 500),
      }
    : undefined;

  const data = {
    ...(patch.name ? { name: patch.name.slice(0, 100) } : {}),
    ...(phoneKey ? { phone: patch.phone!.slice(0, 25), phoneKey } : {}),
    ...(patch.email ? { email: patch.email.slice(0, 200) } : {}),
    ...(patch.address ? { address: patch.address.slice(0, 400) } : {}),
    ...(patch.city ? { city: patch.city.slice(0, 100) } : {}),
    ...(patch.deliveryAreaId ? { deliveryAreaId: patch.deliveryAreaId.slice(0, 50) } : {}),
    ...(patch.preferredLocale ? { preferredLocale: patch.preferredLocale } : {}),
    ...(patch.budgetHint ? { budgetHint: patch.budgetHint.slice(0, 100) } : {}),
    ...(consentRecord ? { marketingConsent: consentRecord } : {}),
    lastSeenAt: new Date(),
  };

  if (!profile) {
    profile = await prisma.customerProfile.create({
      data: {
        storeId: session.storeId,
        visitorIds: [session.visitorId],
        interests: mergeInterests([], patch.interests),
        ...data,
      },
    });
    await prisma.customerEvent.updateMany({
      where: { storeId: session.storeId, visitorId: session.visitorId, profileId: null },
      data: { profileId: profile.id },
    });
    return profile;
  }

  return prisma.customerProfile.update({
    where: { id: profile.id },
    data: {
      ...data,
      interests: mergeInterests(profile.interests, patch.interests),
      ...(profile.visitorIds.includes(session.visitorId) ? {} : { visitorIds: { push: session.visitorId } }),
    },
  });
}

/** Saves a phone number the customer said, right away, so it's never lost or re-asked. */
export async function capturePhoneFromSpeech(
  context: { storeId: string; visitorId: string; locale: string },
  text: string,
): Promise<void> {
  const phone = findPhoneNumber(text);
  if (!phone) return;
  await upsertProfile({ storeId: context.storeId, visitorId: context.visitorId }, { phone, preferredLocale: context.locale }).catch(
    () => undefined,
  );
}

export type SavedDetails = { name: string; phone: string; address: string; city: string; deliveryAreaId: string };

/** The delivery details this visitor gave before, for reuse on the next order. */
export async function savedDetailsForVisitor(storeId: string, visitorId: string): Promise<SavedDetails | null> {
  const profile = await findProfileForVisitor(storeId, visitorId);
  if (!profile || (!profile.name && !profile.phone && !profile.address)) return null;
  return {
    name: profile.name,
    phone: profile.phone,
    address: profile.address ?? "",
    city: profile.city ?? "",
    deliveryAreaId: profile.deliveryAreaId ?? "",
  };
}

/** Updates the buyer's profile after an order (called for every placed order; never throws). */
export async function recordOrderOnProfile(order: Order): Promise<void> {
  try {
    if (!order.sessionId) return;
    const session = await prisma.chatSession.findUnique({ where: { id: order.sessionId }, select: { visitorId: true } });
    if (!session) return;
    const profile = await upsertProfile(
      { storeId: order.storeId, visitorId: session.visitorId },
      {
        name: order.customer.name,
        phone: order.customer.phone,
        email: order.customer.email || undefined,
        address: order.customer.address,
        city: order.customer.city || undefined,
      },
    );
    await prisma.customerProfile.update({
      where: { id: profile.id },
      data: { orderCount: { increment: 1 }, totalSpentMinor: { increment: order.totalMinor }, lastOrderAt: order.createdAt },
    });
  } catch (error) {
    logger.warn("customer.order_profile_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}
