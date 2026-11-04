import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { readClickToken } from "@/modules/marketing/consent";
import { recordMarketingClick } from "@/modules/marketing/campaign.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tracked link from a marketing message: records the click, then redirects to a page of this store
// (relative paths only, so the link can't be abused as an open redirect).
export async function GET(request: NextRequest) {
  const messageId = readClickToken(request.nextUrl.searchParams.get("t"));
  const to = request.nextUrl.searchParams.get("to") ?? "/";
  const path = to.startsWith("/") && !to.startsWith("//") && !to.includes("\\") ? to : "/";
  if (messageId) {
    await recordMarketingClick(messageId).catch((error) => logger.warn("marketing.click_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
  return NextResponse.redirect(new URL(path, env.APP_BASE_URL), 302);
}
