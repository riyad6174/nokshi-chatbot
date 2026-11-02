import { z } from "zod";
import { addItem } from "@/modules/cart/cart.service";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { cartCompact, cartErrorToResult, failure, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  productId: z.string().min(1).max(100).optional(),
  // The product by name, used when the id is missing or wrong.
  product: z.string().trim().min(1).max(200).optional(),
  variantId: z.string().min(1).max(100).nullish(),
  // The version by name ("Silver / Tan", "Black"): safer than copying a long id.
  variant: z.string().trim().min(1).max(100).nullish(),
  quantity: z.number().int().min(1).max(99).default(1),
});

/** An active product's id from its name, matched loosely; null unless exactly one matches. */
async function productIdByName(storeId: string, name: string): Promise<string | null> {
  const products = await prisma.product.findMany({ where: { storeId, status: "active" }, select: { id: true, name: true } });
  const wanted = name.trim().toLowerCase();
  const exact = products.find((product) => product.name.toLowerCase() === wanted);
  if (exact) return exact.id;
  const partial = products.filter((product) => product.name.toLowerCase().includes(wanted) || wanted.includes(product.name.toLowerCase()));
  return partial.length === 1 ? partial[0]!.id : null;
}

/** A variant id from its title, matched loosely ("silver" -> "Silver / Tan leather"). */
async function variantIdByTitle(productId: string, title: string): Promise<string | null> {
  if (!isObjectId(productId)) return null;
  const variants = await prisma.productVariant.findMany({ where: { productId }, select: { id: true, title: true } });
  const wanted = title.trim().toLowerCase();
  const exact = variants.find((variant) => variant.title.toLowerCase() === wanted);
  if (exact) return exact.id;
  const partial = variants.filter((variant) => variant.title.toLowerCase().includes(wanted) || wanted.includes(variant.title.toLowerCase()));
  return partial.length === 1 ? partial[0]!.id : null;
}

export const addToCartTool: ToolDefinition = {
  name: "add_to_cart",
  description:
    "Add a product to the cart. Use the productId from search results. For the version, pass `variant` with its name exactly as listed (e.g. \"Silver / Tan leather\") or the variantId; leave both out when only one version is in stock and it is picked automatically. Ask which version only if several are in stock. If it fails with variant_unavailable, only that version is sold out: never tell the customer the product is out of stock; add the available version they discussed instead.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      productId: { type: "string", description: "productId from search results or from the [On screen ...] notes in the conversation." },
      product: { type: "string", description: "Product name exactly as shown, e.g. \"Urban Trek Backpack\" (used if the id is missing or wrong)." },
      variant: { type: "string", description: "Version name as listed, e.g. \"Silver / Tan leather\" (preferred over variantId)." },
      variantId: { type: "string", description: "Variant id from search results (alternative to `variant`)." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "Units to add (default 1)." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    // A wrong or missing id with a product name: find it by name (ids are easy to mis-copy).
    let productId = input.productId ?? "";
    const known = isObjectId(productId)
      ? await prisma.product.findFirst({ where: { id: productId, storeId: ctx.session.storeId, status: "active" }, select: { id: true } })
      : null;
    if (!known && input.product) productId = (await productIdByName(ctx.session.storeId, input.product)) ?? productId;
    if (!productId) {
      return failure("product_required", "Pass the product name (as shown on its card) or its productId.");
    }
    const variantId = input.variant ? (await variantIdByTitle(productId, input.variant)) ?? input.variantId : input.variantId;
    try {
      const cart = await addItem({
        sessionId: ctx.session.sessionId,
        storeId: ctx.session.storeId,
        currency: ctx.session.store.currency,
        productId,
        variantId: variantId ?? null,
        quantity: input.quantity,
      });
      return success(
        {
          message: "Item added to the cart. Totals below are authoritative.",
          cart: cartCompact(cart),
        },
        [{ type: "cart_summary", cart, label: "Added to cart" }],
      );
    } catch (error) {
      return cartErrorToResult(error);
    }
  },
};
