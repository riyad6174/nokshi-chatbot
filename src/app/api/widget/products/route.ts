import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, validationError } from "@/lib/http";
import { readWidgetSessionId } from "@/lib/auth/widget";
import { getSessionContext } from "@/modules/conversations/session.service";
import { searchProducts } from "@/modules/catalog/product.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(300).optional(),
  category: z.string().trim().max(100).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

export async function GET(request: NextRequest) {
  const sessionId = readWidgetSessionId(request);
  if (!sessionId) return jsonError(401, "session_required", "Start a chat session first.");
  const context = await getSessionContext(sessionId);
  if (!context) return jsonError(401, "session_expired", "Your chat session expired.");

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return validationError(parsed.error);

  const products = await searchProducts({
    storeId: context.storeId,
    text: parsed.data.q,
    category: parsed.data.category,
    maxPriceMinor: parsed.data.maxPriceMinor,
    limit: parsed.data.limit ?? 8,
  });

  return jsonOk({ products });
}
