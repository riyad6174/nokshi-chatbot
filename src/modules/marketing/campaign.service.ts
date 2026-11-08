import type { Job, MarketingCampaign } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { logger } from "@/lib/logging/logger";
import { priceLabel } from "@/lib/money";
import { recommend } from "@/modules/catalog/recommendation.service";
import { trackEvent } from "@/modules/customers/events.service";
import { enqueueJob, PermanentJobError } from "@/modules/jobs/job.service";
import { deliver } from "@/modules/marketing/channels";
import { canMarket, MARKETING_CHANNELS, trackedLink, unsubscribeUrl, type MarketingChannel } from "@/modules/marketing/consent";
import { parseSegment, segmentProfiles, segmentSchema } from "@/modules/marketing/segments";
import { resolveSalesConfig } from "@/modules/sales/config";

// Campaigns: one-off broadcasts and product follow-ups to a segment, and the abandoned-cart
// automation. Every message is queued as a durable job, consent is checked when queued and again
// when sent, and each (campaign, customer, occasion) is sent at most once.

export const CAMPAIGN_KINDS = ["abandoned_cart", "product_followup", "broadcast"] as const;

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(CAMPAIGN_KINDS),
  channel: z.enum(MARKETING_CHANNELS),
  subject: z.string().trim().max(150).default(""),
  body: z.string().trim().min(10).max(2000),
  delayMinutes: z.number().int().min(15).max(7 * 24 * 60).default(60),
  segment: segmentSchema.default({}),
});
export type CampaignInput = z.input<typeof campaignInputSchema>;

export async function createCampaign(storeId: string, input: CampaignInput): Promise<MarketingCampaign> {
  const data = campaignInputSchema.parse(input);
  return prisma.marketingCampaign.create({
    data: { storeId, name: data.name, kind: data.kind, channel: data.channel, subject: data.subject, body: data.body, delayMinutes: data.delayMinutes, segment: JSON.stringify(data.segment) },
  });
}

/** Placeholders: {name} {store} {cart} {products} {link}. An unsubscribe line is always added. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(name|store|cart|products|link)\}/g, (_, key: string) => values[key] ?? "").replace(/[ \t]+\n/g, "\n").trim();
}

function withUnsubscribe(text: string, url: string, channel: MarketingChannel): string {
  return channel === "email" ? `${text}\n\nUnsubscribe: ${url}` : `${text}\nStop: ${url}`;
}

async function queueMessage(input: { campaign: MarketingCampaign; profileId: string; dedupeKey: string; cartId?: string | null; runAt?: Date }) {
  const message = await prisma.marketingMessage
    .create({
      data: {
        storeId: input.campaign.storeId,
        campaignId: input.campaign.id,
        profileId: input.profileId,
        channel: input.campaign.channel,
        recipient: "",
        dedupeKey: input.dedupeKey,
        cartId: input.cartId ?? null,
      },
    })
    .catch((error: { code?: string }) => {
      if (error.code === "P2002") return null; // Already queued or sent for this occasion.
      throw error;
    });
  if (!message) return false;
  await enqueueJob({ type: "marketing.send", storeId: input.campaign.storeId, payload: { messageId: message.id }, dedupeKey: message.id, runAt: input.runAt, maxAttempts: 4 });
  return true;
}

/** Sends a broadcast / product follow-up to its segment (consented, reachable customers only). */
export async function launchCampaign(storeId: string, campaignId: string): Promise<{ queued: number; skipped: number }> {
  if (!isObjectId(campaignId)) throw new Error("Unknown campaign.");
  const campaign = await prisma.marketingCampaign.findFirst({ where: { id: campaignId, storeId } });
  if (!campaign) throw new Error("Unknown campaign.");
  if (campaign.kind === "abandoned_cart") {
    await prisma.marketingCampaign.update({ where: { id: campaign.id }, data: { status: "active", launchedAt: campaign.launchedAt ?? new Date() } });
    return { queued: 0, skipped: 0 };
  }
  const profiles = await segmentProfiles(storeId, parseSegment(campaign.segment));
  let queued = 0;
  let skipped = 0;
  for (const profile of profiles) {
    if (!canMarket(profile, campaign.channel as MarketingChannel).ok) {
      skipped += 1;
      continue;
    }
    if (await queueMessage({ campaign, profileId: profile.id, dedupeKey: "launch" })) queued += 1;
  }
  await prisma.marketingCampaign.update({ where: { id: campaign.id }, data: { status: "completed", launchedAt: new Date() } });
  logger.info("marketing.campaign_launched", { storeId, campaignId, queued, skipped });
  return { queued, skipped };
}

export async function setCampaignStatus(storeId: string, campaignId: string, status: "active" | "paused") {
  if (!isObjectId(campaignId)) return;
  await prisma.marketingCampaign.updateMany({ where: { id: campaignId, storeId, kind: "abandoned_cart" }, data: { status } });
}

/**
 * For each store with an active abandoned-cart campaign: queue one reminder per recently abandoned
 * cart whose shopper has a profile, after the campaign's delay. Runs from the abandoned-carts cron.
 */
export async function scheduleAbandonedCartReminders(now = new Date()): Promise<number> {
  const campaigns = await prisma.marketingCampaign.findMany({ where: { kind: "abandoned_cart", status: "active" } });
  let queued = 0;
  for (const campaign of campaigns) {
    const events = await prisma.customerEvent.findMany({
      where: { storeId: campaign.storeId, type: "abandoned_cart", at: { gte: new Date(now.getTime() - 3 * 86_400_000) }, cartId: { not: null } },
      take: 1000,
    });
    for (const event of events) {
      const profile =
        (event.profileId ? await prisma.customerProfile.findFirst({ where: { id: event.profileId, storeId: campaign.storeId } }) : null) ??
        (await prisma.customerProfile.findFirst({ where: { storeId: campaign.storeId, visitorIds: { has: event.visitorId } } }));
      if (!profile || !canMarket(profile, campaign.channel as MarketingChannel).ok) continue;
      const job = await enqueueJob({
        type: "marketing.abandoned_cart",
        storeId: campaign.storeId,
        payload: { campaignId: campaign.id, cartId: event.cartId, profileId: profile.id },
        dedupeKey: `${campaign.id}:${event.cartId}`,
        runAt: new Date(event.at.getTime() + campaign.delayMinutes * 60_000),
        maxAttempts: 3,
      });
      if (job.created) queued += 1;
    }
  }
  return queued;
}

/** Job: an abandoned-cart reminder, if the cart is still waiting and the customer still consents. */
export async function handleAbandonedCartJob(_job: Job, payload: Record<string, unknown>) {
  const { campaignId, cartId, profileId } = payload as { campaignId?: string; cartId?: string; profileId?: string };
  if (!isObjectId(campaignId) || !isObjectId(cartId) || !isObjectId(profileId)) throw new PermanentJobError("Bad payload.");
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "active") return;
  const cart = await prisma.cart.findFirst({ where: { id: cartId, storeId: campaign.storeId }, include: { items: true } });
  // Bought or emptied in the meantime: nothing to remind about.
  if (!cart || cart.status !== "active" || cart.items.length === 0) return;
  const ordered = await prisma.customerEvent.findFirst({ where: { cartId, type: "order_placed" }, select: { id: true } });
  if (ordered) return;
  await queueMessage({ campaign, profileId, dedupeKey: cartId, cartId });
}

/** Job: render and deliver one queued marketing message. */
export async function handleSendJob(_job: Job, payload: Record<string, unknown>) {
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  if (!isObjectId(messageId)) throw new PermanentJobError("Bad payload.");
  const message = await prisma.marketingMessage.findUnique({
    where: { id: messageId },
    include: { campaign: true, profile: true, store: { include: { settings: true } } },
  });
  if (!message || message.status !== "queued") return;
  const channel = message.channel as MarketingChannel;
  // Consent is checked again at send time: an unsubscribe after queueing always wins.
  const reach = canMarket(message.profile, channel);
  if (!reach.ok) {
    await prisma.marketingMessage.update({ where: { id: message.id }, data: { status: "skipped", reason: reach.reason } });
    return;
  }

  let cartText = "";
  let productsText = "";
  if (message.cartId) {
    const cart = await prisma.cart.findFirst({ where: { id: message.cartId, storeId: message.storeId }, include: { items: { include: { product: true } } } });
    cartText = (cart?.items ?? []).map((item) => `${item.quantity}x ${item.product.name}`).join(", ");
    const anchors = (cart?.items ?? []).map((item) => item.productId);
    if (anchors.length > 0) {
      const suggestions = await recommend({ storeId: message.storeId, kind: "complementary", anchorProductIds: anchors, config: resolveSalesConfig(message.store.settings), limit: 2 });
      productsText = suggestions.recommendations.map((entry) => `${entry.product.name} (${priceLabel(entry.product.priceMinor, entry.product.currency)})`).join(", ");
    }
  } else {
    const suggestions = await recommend({
      storeId: message.storeId,
      kind: "personalized",
      anchorProductIds: [],
      interests: message.profile.interests,
      config: resolveSalesConfig(message.store.settings),
      limit: 3,
    });
    productsText = suggestions.recommendations.map((entry) => `${entry.product.name} (${priceLabel(entry.product.priceMinor, entry.product.currency)})`).join(", ");
  }

  const unsubscribe = unsubscribeUrl(message.profileId, message.storeId);
  const values = {
    name: message.profile.name || "there",
    store: message.store.name,
    cart: cartText,
    products: productsText,
    link: trackedLink(message.id, "/"),
  };
  const text = withUnsubscribe(renderTemplate(message.campaign.body, values), unsubscribe, channel);
  const subject = renderTemplate(message.campaign.subject || message.store.name, values).slice(0, 150);
  try {
    const result = await deliver({ channel, to: reach.recipient, subject, text, unsubscribeUrl: unsubscribe, storeName: message.store.name, messageId: message.id });
    await prisma.marketingMessage.update({
      where: { id: message.id },
      data: { status: "sent", sentAt: new Date(), recipient: reach.recipient, subject, body: text, reason: result.provider },
    });
    const visitorId = message.profile.visitorIds[message.profile.visitorIds.length - 1];
    const session = visitorId ? await prisma.chatSession.findFirst({ where: { storeId: message.storeId, visitorId }, orderBy: { lastActivityAt: "desc" }, select: { id: true } }) : null;
    if (session && visitorId) {
      await trackEvent({ storeId: message.storeId, sessionId: session.id, visitorId, type: "marketing_sent", cartId: message.cartId, meta: { campaignId: message.campaignId, channel } });
    }
  } catch (error) {
    await prisma.marketingMessage.update({ where: { id: message.id }, data: { reason: (error instanceof Error ? error.message : String(error)).slice(0, 200) } });
    throw error; // The job retries with backoff; after the last attempt the message stays queued with the reason.
  }
}

/** A click on a tracked link in a marketing message. */
export async function recordMarketingClick(messageId: string) {
  const message = await prisma.marketingMessage.findUnique({ where: { id: messageId }, include: { profile: true } });
  if (!message || message.clickedAt) return;
  await prisma.marketingMessage.update({ where: { id: message.id }, data: { clickedAt: new Date() } });
  const visitorId = message.profile.visitorIds[message.profile.visitorIds.length - 1];
  const session = visitorId ? await prisma.chatSession.findFirst({ where: { storeId: message.storeId, visitorId }, orderBy: { lastActivityAt: "desc" }, select: { id: true } }) : null;
  if (session && visitorId) {
    await trackEvent({ storeId: message.storeId, sessionId: session.id, visitorId, type: "marketing_clicked", cartId: message.cartId, meta: { campaignId: message.campaignId } });
  }
}
