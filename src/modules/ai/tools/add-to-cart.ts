import { z } from "zod";
import { addItem } from "@/modules/cart/cart.service";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { parseOptions, sizeCode } from "@/modules/catalog/product.service";
import { cartCompact, cartErrorToResult, failure, productIdAtPosition, productIdByName, success } from "@/modules/ai/tools/helpers";
import type { ToolDefinition } from "@/modules/ai/tools/types";

const schema = z.object({
  productId: z.string().min(1).max(100).optional(),
  // The product by name, used when the id is missing or wrong.
  product: z.string().trim().min(1).max(200).optional(),
  variantId: z.string().min(1).max(100).nullish(),
  // The version by name ("Silver / Tan", "Black"): safer than copying a long id.
  variant: z.string().trim().min(1).max(100).nullish(),
  // "The second one": its number in the latest product list on screen.
  position: z.number().int().min(1).max(24).optional(),
  quantity: z.number().int().min(1).max(99).default(1),
});

/**
 * A variant id from what the customer called it: its name ("Medium", "silver" -> "Silver / Tan
 * leather"), a size code or word ("M" = "Medium"), or an option value. Null unless exactly one fits.
 */
async function variantIdByTitle(productId: string, title: string): Promise<string | null> {
  if (!isObjectId(productId)) return null;
  const variants = await prisma.productVariant.findMany({ where: { productId }, select: { id: true, title: true, options: true } });
  const wanted = title.trim().toLowerCase().replace(/\s+size$|^size\s+/, "");
  const exact = variants.find((variant) => variant.title.toLowerCase() === wanted);
  if (exact) return exact.id;
  // Same size or option: "M" <-> "Medium", "medium" <-> size "M".
  const same = variants.filter((variant) => {
    const values = [variant.title, ...Object.values(parseOptions(variant.options))].map((value) => value.toLowerCase());
    return values.some((value) => sizeCode(value) === sizeCode(wanted));
  });
  if (same.length === 1) return same[0]!.id;
  const partial = variants.filter((variant) => variant.title.toLowerCase().includes(wanted) || wanted.includes(variant.title.toLowerCase()));
  return partial.length === 1 ? partial[0]!.id : null;
}

export const addToCartTool: ToolDefinition = {
  name: "add_to_cart",
  description:
    "Add a product to the cart (by productId, name as shown, or position on screen). Pass `variant` by its listed name (or variantId); omit it when only one version is in stock. Ask which version only if several are. Error variant_unavailable means only that version is sold out: never say the product is out of stock; add the available version they discussed instead.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      productId: { type: "string", description: "From search results or [On screen ...] notes." },
      product: { type: "string", description: "Name as shown, e.g. \"Urban Trek Backpack\" (used if the id is missing or wrong)." },
      variant: { type: "string", description: "Version name as listed, e.g. \"Silver / Tan leather\"." },
      variantId: { type: "string" },
      position: { type: "integer", minimum: 1, maximum: 24, description: "Number in the latest product list on screen (\"the second one\" = 2), instead of productId/product." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "Default 1." },
    },
  },
  schema,
  async execute(ctx, args) {
    const input = schema.parse(args);
    // A wrong or missing id with a product name: find it by name (ids are easy to mis-copy).
    let productId = input.productId ?? "";
    // Picked by number: the list on screen decides, not an id the model may have mixed up.
    if (input.position) {
      const atPosition = await productIdAtPosition(ctx.session.conversationId, input.position, ctx.shownThisTurn);
      if (!atPosition) return failure("position_not_found", `There is no product number ${input.position} on screen. Ask which product they mean.`);
      productId = atPosition;
    }
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
