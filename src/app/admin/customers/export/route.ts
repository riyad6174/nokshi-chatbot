import { getAdminUser } from "@/lib/auth/admin";
import { jsonError } from "@/lib/http";
import { listOptedInCustomers } from "@/modules/customers/admin.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Spreadsheet apps run cells that start with these as formulas: neutralize them.
function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV of customers who agreed to marketing, with when and how they agreed. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return jsonError(401, "unauthorized", "Sign in to the dashboard first.");
  const store = await getPrimaryStore();
  if (!store) return jsonError(404, "store_not_found", "No store configured.");

  const customers = await listOptedInCustomers(store.id);
  const header = [
    "name",
    "phone",
    "email",
    "channels",
    "consented_at",
    "consent_source",
    "preferred_language",
    "interests",
    "budget",
    "orders",
    "total_spent",
    "last_order_at",
  ];
  const rows = customers.map((customer) =>
    [
      customer.name,
      customer.phone,
      customer.email,
      customer.marketingConsent?.channels.join(" "),
      customer.marketingConsent?.at.toISOString(),
      customer.marketingConsent?.source,
      customer.preferredLocale,
      customer.interests.join("; "),
      customer.budgetHint,
      customer.orderCount,
      (customer.totalSpentMinor / 100).toFixed(2),
      customer.lastOrderAt?.toISOString() ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  const body = `﻿${[header.join(","), ...rows].join("\r\n")}\r\n`;
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-opted-in-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
