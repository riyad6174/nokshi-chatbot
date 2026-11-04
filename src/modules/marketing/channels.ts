import { createHmac } from "node:crypto";
import { logger } from "@/lib/logging/logger";
import type { MarketingChannel } from "@/modules/marketing/consent";

// Delivery of marketing messages. MARKETING_PROVIDER selects how:
// - "log" (default): dry run, nothing leaves the server; messages are logged (recipient masked).
// - "webhook": POST JSON to MARKETING_WEBHOOK_URL, signed with MARKETING_WEBHOOK_SECRET
//   (header X-Nokshi-Signature: sha256=<hex HMAC of the body>). Connect any SMS/WhatsApp/email
//   gateway or automation tool (Zapier, n8n, a Twilio function) this way.
// - "resend": email through the Resend API (MARKETING_EMAIL_API_KEY, MARKETING_EMAIL_FROM);
//   SMS/WhatsApp then go to the webhook if one is set.
// Transactional order messages never go through here.

export type OutgoingMessage = {
  channel: MarketingChannel;
  to: string;
  subject: string;
  text: string;
  unsubscribeUrl: string;
  storeName: string;
  messageId: string;
};

export type SendResult = { delivered: boolean; provider: string; providerId?: string };

function provider(): "log" | "webhook" | "resend" {
  const value = (process.env.MARKETING_PROVIDER ?? "log").trim().toLowerCase();
  return value === "webhook" || value === "resend" ? value : "log";
}

function mask(value: string): string {
  return value.length <= 4 ? "****" : `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

async function viaWebhook(message: OutgoingMessage): Promise<SendResult> {
  const url = process.env.MARKETING_WEBHOOK_URL ?? "";
  if (!/^https:\/\//.test(url) && !(process.env.NODE_ENV !== "production" && /^http:\/\//.test(url))) {
    throw new Error("MARKETING_WEBHOOK_URL is not set (https required in production).");
  }
  const body = JSON.stringify({
    channel: message.channel,
    to: message.to,
    subject: message.subject,
    text: message.text,
    unsubscribeUrl: message.unsubscribeUrl,
    store: message.storeName,
    messageId: message.messageId,
  });
  const secret = process.env.MARKETING_WEBHOOK_SECRET ?? "";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Nokshi-Signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` } : {}),
      "Idempotency-Key": message.messageId,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Marketing webhook failed (${response.status}).`);
  return { delivered: true, provider: "webhook" };
}

async function viaResend(message: OutgoingMessage): Promise<SendResult> {
  const key = process.env.MARKETING_EMAIL_API_KEY ?? "";
  const from = process.env.MARKETING_EMAIL_FROM ?? "";
  if (!key || !from) throw new Error("MARKETING_EMAIL_API_KEY and MARKETING_EMAIL_FROM are required for Resend.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Idempotency-Key": message.messageId },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      // One-click unsubscribe (RFC 8058), which mailbox providers expect for marketing mail.
      headers: { "List-Unsubscribe": `<${message.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Email provider failed (${response.status}).`);
  const body = (await response.json().catch(() => ({}))) as { id?: string };
  return { delivered: true, provider: "resend", providerId: body.id };
}

export async function deliver(message: OutgoingMessage): Promise<SendResult> {
  const mode = provider();
  if (mode === "resend" && message.channel === "email") return viaResend(message);
  if (mode === "webhook" || (mode === "resend" && process.env.MARKETING_WEBHOOK_URL)) return viaWebhook(message);
  logger.info("marketing.dry_run", { channel: message.channel, to: mask(message.to), subject: message.subject.slice(0, 80), messageId: message.messageId });
  return { delivered: true, provider: "log" };
}
