import { z } from "zod";
import { computeFacets, searchProducts } from "@/modules/catalog/product.service";
import { productCompact, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import type { ChatPart } from "@/types/chat";

const schema = z.object({
  query: z.string().trim().max(300).optional(),
  category: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(100).optional(),
  filters: z.record(z.string().max(40), z.string().max(80)).optional(),
  minPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  maxPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  limit: z.number().int().min(1).max(8).optional(),
});

export const searchProductsTool: ToolDefinition = {
  name: "search_products",
  description:
    "Search the store's active catalog. Use for every recommendation, availability or price question. Returns products plus `facets` (brands, colors, sizes, materials present in the results). When there are several matches, ask ONE short question using the facets to narrow down (e.g. which color or brand), then search again with `filters`/`brand`. Prices are integers in minor units (100 = 1 BDT).",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Free text, e.g. 'backpack', 'gift for dad', 'cotton panjabi'." },
      category: { type: "string", description: "Category filter, e.g. Bags, Electronics, Clothing, Home, Accessories." },
      brand: { type: "string", description: "Brand filter." },
      filters: {
        type: "object",
        description: "Narrow by variant option or attribute, e.g. {\"color\":\"Black\"} or {\"material\":\"canvas\"}.",
        additionalProperties: { type: "string" },
      },
      minPriceMinor: { type: "integer", minimum: 0, description: "Minimum unit price in minor units." },
      maxPriceMinor: { type: "integer", minimum: 0, description: "Maximum unit price in minor units. 300000 = 3,000 BDT." },
      limit: { type: "integer", minimum: 1, maximum: 8, description: "Number of products to return (default 6)." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    const products = await searchProducts({
      storeId: ctx.session.storeId,
      text: input.query,
      category: input.category,
      brand: input.brand,
      filters: input.filters,
      minPriceMinor: input.minPriceMinor,
      maxPriceMinor: input.maxPriceMinor,
      limit: input.limit ?? 6,
    });
    const facets = products.length > 1 ? computeFacets(products) : [];

    const ui: ChatPart[] = [];
    if (products.length > 0) ui.push({ type: "product_list", products });
    if (facets.length > 0) ui.push({ type: "refine_options", options: { query: input.query ?? input.category ?? "", facets } });

    return success(
      {
        count: products.length,
        products: products.map(productCompact),
        facets,
        ...(products.length === 0
          ? { note: "No products matched. Do not invent products. Offer to broaden the search or change filters." }
          : {}),
      },
      ui.length > 0 ? ui : undefined,
    );
  },
};
