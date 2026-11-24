import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { failure, focusedProductId, productIdAtPosition, productsMatchingName, success } from "@/modules/ai/tools/helpers";
import { resolveSalesConfig } from "@/modules/sales/config";
import type { ToolDefinition } from "@/modules/ai/tools/types";
import { CheckoutError, prepareCheckoutForSession, saveCheckoutCustomer } from "@/modules/commerce/checkout.service";
import { UntrustedCheckoutUrlError } from "@/modules/commerce/checkout-url";
import { savedDetailsForVisitor } from "@/modules/customers/profile.service";

// Tools that take the customer somewhere in the store. The widget moves between pages without a
// reload, so a voice call carries on while the page changes.

/** A same-site path for in-app navigation; absolute URLs on our own site are reduced to their path. */
function sitePath(url: string): string {
  try {
    const parsed = new URL(url, "http://local");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

const productSchema = z.object({
  product: z.string().trim().min(1).max(200).optional(),
  productId: z.string().trim().max(100).optional(),
  position: z.number().int().min(1).max(50).optional(),
});

export const openProductPageTool: ToolDefinition = {
  name: "open_product_page",
  description:
    "Open a product's own page (full photos and details) when the customer asks to open, see or go to its page (\"পেজটা খুলুন\", \"take me there\"). Pass the name as on the card, the productId, or its number on screen; with none, the product being talked about is opened. Not for \"tell me about it\" (that's get_product_details).",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      product: { type: "string", description: 'Product name as shown, e.g. "Urban Trek Backpack".' },
      productId: { type: "string" },
      position: { type: "integer", minimum: 1, description: "Its number among the products on screen (1 = first)." },
    },
  },
  schema: productSchema,
  async execute(ctx, args) {
    const input = productSchema.parse(args);
    const storeId = ctx.session.storeId;
    let productId = input.productId && isObjectId(input.productId) ? input.productId : null;
    if (!productId && input.position) productId = await productIdAtPosition(ctx.session.conversationId, input.position);
    if (!productId && input.product) {
      const matches = await productsMatchingName(storeId, input.product, resolveSalesConfig(ctx.session.store.settings).synonyms);
      if (matches.length === 1) productId = matches[0]!.id;
      else if (matches.length > 1) {
        // "the bag" with several bags: the one being talked about, if it's one of them.
        const focused = await focusedProductId(ctx.session.conversationId, storeId);
        if (focused && matches.some((match) => match.id === focused)) productId = focused;
        else {
          return failure(
            "ambiguous_product",
            `Several products match: ${matches.slice(0, 6).map((match) => match.name).join(", ")}. Ask which one they want to open (by name or number).`,
          );
        }
      }
    }
    // No name, id or number: the product being talked about.
    if (!productId && !input.product && !input.position) productId = await focusedProductId(ctx.session.conversationId, storeId);
    const product = productId
      ? await prisma.product.findFirst({
          where: { id: productId, storeId, status: "active" },
          select: { name: true, slug: true },
        })
      : null;
    if (!product) {
      return failure(
        "product_not_found",
        "No product matched. Ask which product they mean (by name or its number on screen), or search_products first and open the one they pick.",
      );
    }
    return success(
      {
        opened: true,
        product: product.name,
        note: `The page is opening and the card overlay is closed. Say one short line ("পেজটা খুলে দিলাম" / "Here's its page"). Don't call other product tools for it.`,
      },
      [{ type: "navigate", url: `/products/${product.slug}`, label: product.name }],
    );
  },
};

export const goToCheckoutTool: ToolDefinition = {
  name: "go_to_checkout",
  description:
    "Take the customer to the checkout page with the current cart, pre-filled with the name, phone and address you know. Use when they want to pay online, see everything on one page, or ask to go to checkout. To order cash on delivery by voice, use propose_order / confirm_order instead (that also works while they are on the checkout page).",
  parameters: { type: "object", additionalProperties: false, properties: {} },
  schema: z.object({}),
  async execute(ctx) {
    try {
      const prepared = await prepareCheckoutForSession({ sessionId: ctx.session.sessionId, store: ctx.session.store });
      const saved = await savedDetailsForVisitor(ctx.session.storeId, ctx.session.visitorId).catch(() => null);
      const prefilled = Boolean(saved?.name && saved.phone && saved.address);
      if (saved && prefilled) {
        await saveCheckoutCustomer(prepared.checkoutSessionId, {
          name: saved.name,
          phone: saved.phone,
          email: "",
          address: saved.address,
          city: saved.city,
          notes: "",
        });
      }
      return success(
        {
          opened: true,
          prefilled,
          note: prefilled
            ? "Checkout is opening with their details filled in. Say one short line. They can place the order on the page, or by saying yes to your order summary."
            : "Checkout is opening. Say one short line; they fill in their details on the page.",
        },
        [{ type: "navigate", url: sitePath(prepared.checkoutUrl), label: "Checkout" }],
      );
    } catch (error) {
      if (error instanceof CheckoutError) return failure(error.code, error.message, error.details);
      if (error instanceof UntrustedCheckoutUrlError) return failure("checkout_failed", "Checkout could not be prepared.");
      throw error;
    }
  },
};
