import type { NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { applyUnsubscribe } from "@/modules/marketing/consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>` +
      `<style>body{font-family:system-ui,sans-serif;background:#f5f5f4;color:#1c1917;margin:0;padding:48px 16px}main{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:24px}button{background:#1c1917;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}</style>` +
      `</head><body><main>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

// GET shows a confirmation button (link scanners open links without meaning to unsubscribe);
// POST unsubscribes. Mail clients' one-click unsubscribe (RFC 8058) also POSTs here.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!token) return page("Unsubscribe", "<p>This link is incomplete.</p>", 400);
  return page(
    "Unsubscribe",
    `<h1 style="font-size:18px">Stop marketing messages?</h1><p>You'll no longer receive offers or reminders. Order updates are not affected.</p>` +
      `<form method="post" action="/api/marketing/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(request: NextRequest) {
  const rate = await rateLimit(`unsubscribe:${getClientIp(request)}`, 30, 60_000);
  if (!rate.allowed) return page("Unsubscribe", "<p>Too many requests. Please try again in a minute.</p>", 429);
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const result = await applyUnsubscribe(token);
  if (!result.ok) return page("Unsubscribe", "<p>This unsubscribe link isn't valid.</p>", 400);
  return page("Unsubscribed", `<h1 style="font-size:18px">You're unsubscribed</h1><p>${escape(result.storeName ?? "The store")} won't send you marketing messages any more.</p>`);
}
