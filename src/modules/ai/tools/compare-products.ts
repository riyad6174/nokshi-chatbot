import { z } from "zod";
import { priceLabel } from "@/lib/money";
import { getProductById } from "@/modules/catalog/product.service";
import { trackEvent } from "@/modules/customers/events.service";
import { failure, productIdByName, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import type { ProductCardData } from "@/types/chat";

const schema = z.object({
  products: z.array(z.string().trim().min(1).max(200)).min(2).max(4),
});

/** Rows of catalog facts that differ or matter, built only from product data. */
export function comparisonRows(products: ProductCardData[]): Array<{ label: string; values: string[] }> {
  const rows: Array<{ label: string; values: string[] }> = [
    { label: "Price", values: products.map((product) => priceLabel(product.priceMinor, product.currency)) },
    { label: "In stock", values: products.map((product) => (product.available ? "Yes" : "Sold out")) },
  ];
  if (products.some((product) => product.brand)) rows.push({ label: "Brand", values: products.map((product) => product.brand || "—") });
  if (new Set(products.map((product) => product.category)).size > 1) {
    rows.push({ label: "Category", values: products.map((product) => product.category) });
  }
  const keys = [...new Set(products.flatMap((product) => Object.keys(product.attributes)))].slice(0, 8);
  for (const key of keys) {
    rows.push({ label: key.replace(/_/g, " "), values: products.map((product) => product.attributes[key] ?? "—") });
  }
  const optionKeys = [...new Set(products.flatMap((product) => product.variants.flatMap((variant) => Object.keys(variant.options))))].slice(0, 3);
  for (const key of optionKeys) {
    rows.push({
      label: `${key} options`,
      values: products.map(
        (product) =>
          [...new Set(product.variants.filter((variant) => variant.available).map((variant) => variant.options[key]).filter(Boolean))].join(", ") || "—",
      ),
    });
  }
  return rows;
}

export const compareProductsTool: ToolDefinition = {
  name: "compare_products",
  description:
    "Compare 2-4 products side by side using catalog facts only (price, stock, brand, attributes, available options). Pass product ids, or names exactly as shown. Shows a comparison card; then give ONE recommendation with a reason based on the customer's need.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["products"],
    properties: {
      products: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "Product ids or names as shown." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const found: ProductCardData[] = [];
    for (const ref of input.products) {
      const byId = await getProductById(ctx.session.storeId, ref);
      const id = byId ? byId.id : await productIdByName(ctx.session.storeId, ref);
      const product = byId ?? (id ? await getProductById(ctx.session.storeId, id) : null);
      if (product && !found.some((entry) => entry.id === product.id)) found.push(product);
    }
    if (found.length < 2) return failure("product_not_found", "Need at least two products of this store to compare. Use the ids or names shown on the cards.");
    const rows = comparisonRows(found);
    await trackEvent({
      storeId: ctx.session.storeId,
      sessionId: ctx.session.sessionId,
      visitorId: ctx.session.visitorId,
      type: "compared",
      meta: { productIds: found.map((product) => product.id) },
    });
    return success(
      {
        products: found.map((product) => ({ id: product.id, name: product.name })),
        comparison: rows,
        note: "The comparison is on screen. Recommend one with a short reason from these facts; don't add specs that aren't listed.",
      },
      [{ type: "comparison", products: found, rows }],
    );
  },
};
