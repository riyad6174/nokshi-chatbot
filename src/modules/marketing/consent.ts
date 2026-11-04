import type { CustomerProfile } from "@prisma/client";
import { seal, unseal } from "@/lib/auth/tokens";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { logger } from "@/lib/logging/logger";

// Marketing consent is checked when a message is queued AND again right before it is sent, so an
// unsubscribe always wins. Consent comes only from the customer's explicit yes (recorded with the
// question asked and their answer by save_customer_profile); there is no implied consent.

export const MARKETING_CHANNELS = ["email", "sms", "whatsapp"] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export type Reachability = { ok: true; recipient: string } | { ok: false; reason: string };

export function canMarket(profile: Pick<CustomerProfile, "marketingConsent" | "unsubscribedAt" | "email" | "phone">, channel: MarketingChannel): Reachability {
  if (profile.unsubscribedAt) return { ok: false, reason: "unsubscribed" };
  const consent = profile.marketingConsent;
  if (!consent?.granted) return { ok: false, reason: "no_consent" };
  if (!consent.channels.includes(channel)) return { ok: false, reason: "channel_not_consented" };
  const recipient = channel === "email" ? profile.email.trim() : profile.phone.trim();
  if (!recipient) return { ok: false, reason: channel === "email" ? "no_email" : "no_phone" };
  return { ok: true, recipient };
}

const TOKEN_KIND = "unsub";

export function unsubscribeToken(profileId: string, storeId: string): string {
  return seal({ k: TOKEN_KIND, p: profileId, s: storeId });
}

export function unsubscribeUrl(profileId: string, storeId: string): string {
  return `${env.APP_BASE_URL}/api/marketing/unsubscribe?token=${encodeURIComponent(unsubscribeToken(profileId, storeId))}`;
}

/** Withdraws marketing consent for the profile the token names. Idempotent. */
export async function applyUnsubscribe(token: string): Promise<{ ok: boolean; storeName?: string }> {
  const payload = unseal<{ k?: string; p?: string; s?: string }>(token);
  if (payload?.k !== TOKEN_KIND || !isObjectId(payload.p) || !isObjectId(payload.s)) return { ok: false };
  const profile = await prisma.customerProfile.findFirst({ where: { id: payload.p, storeId: payload.s }, include: { store: { select: { name: true } } } });
  if (!profile) return { ok: false };
  if (!profile.unsubscribedAt) {
    await prisma.customerProfile.update({
      where: { id: profile.id },
      data: {
        unsubscribedAt: new Date(),
        ...(profile.marketingConsent
          ? { marketingConsent: { set: { ...profile.marketingConsent, granted: false, channels: [], at: new Date(), evidence: "unsubscribe link" } } }
          : {}),
      },
    });
    // Anything already queued for this customer is skipped at send time; mark it now for clarity.
    await prisma.marketingMessage.updateMany({ where: { profileId: profile.id, status: "queued" }, data: { status: "skipped", reason: "unsubscribed" } });
    logger.info("marketing.unsubscribed", { storeId: profile.storeId, profileId: profile.id });
  }
  return { ok: true, storeName: profile.store.name };
}

const CLICK_KIND = "mclick";

/** A tracked link to a page of the store (relative path only, so it can't be used as an open redirect). */
export function trackedLink(messageId: string, path = "/"): string {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${env.APP_BASE_URL}/api/marketing/click?t=${encodeURIComponent(seal({ k: CLICK_KIND, m: messageId }))}&to=${encodeURIComponent(safe)}`;
}

export function readClickToken(token: string | null): string | null {
  const payload = unseal<{ k?: string; m?: string }>(token);
  return payload?.k === CLICK_KIND && isObjectId(payload.m) ? payload.m! : null;
}
