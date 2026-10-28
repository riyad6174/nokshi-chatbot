import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { getSessionContext } from "@/modules/conversations/session.service";
import { getProductById } from "@/modules/catalog/product.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  const { productId } = await params;
  const product = await getProductById(context.storeId, productId);
  if (!product) return jsonError(404, "product_not_found", "That product is not available.");
  return jsonOk({ product });
}
