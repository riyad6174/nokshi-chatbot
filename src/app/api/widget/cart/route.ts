import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { getCartSummary } from "@/modules/cart/cart.service";
import { getSessionContext } from "@/modules/conversations/session.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");

  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  const cart = await getCartSummary(context.sessionId, context.storeId, context.store.currency);
  return jsonOk({ cart });
}
