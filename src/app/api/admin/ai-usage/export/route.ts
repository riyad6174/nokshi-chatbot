import type { NextRequest } from "next/server";
import { getAdminUser } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import { storeUsage, USAGE_PERIODS } from "@/modules/analytics/usage.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function row(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(",");
}

export async function GET(request: NextRequest) {
  const user = await getAdminUser();
  if (!user) return jsonError(401, "admin_required", "Sign in to export usage.");
  const store = await getPrimaryStore();
  if (!store) return jsonError(404, "store_missing", "No store configured.");

  const rawDays = request.nextUrl.searchParams.get("days");
  const days = USAGE_PERIODS.find((value) => String(value) === rawDays) ?? 30;
  const data = await storeUsage(store.id, days);

  const lines = [
    row(["section", "date", "provider", "model", "channel", "source", "requests", "input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "cost_usd", "unpriced_requests"]),
    row(["total", "", "", "", "", "", data.totals.events, data.totals.inputTokens, data.totals.cachedInputTokens, data.totals.cacheWriteInputTokens, data.totals.outputTokens, data.totals.reasoningTokens, data.totals.totalTokens, (data.totals.costMicros / 1_000_000).toFixed(6), data.totals.unpricedEvents]),
    ...data.days.map((day) =>
      row(["day", day.date, "", "", "", "", day.events, day.inputTokens, day.cachedInputTokens, day.cacheWriteInputTokens, day.outputTokens, day.reasoningTokens, day.totalTokens, (day.costMicros / 1_000_000).toFixed(6), day.unpricedEvents]),
    ),
    ...data.byModel.map((model) =>
      row(["model", "", model.providerId, model.model, "", "", model.events, model.inputTokens, model.cachedInputTokens, model.cacheWriteInputTokens, model.outputTokens, model.reasoningTokens, model.totalTokens, (model.costMicros / 1_000_000).toFixed(6), model.unpricedEvents]),
    ),
  ];

  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-usage-${days}d-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
