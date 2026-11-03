import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { isObjectId } from "@/lib/db/ids";
import { failure, productIdByName, success } from "@/modules/ai/tools/helpers";
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
});

export const openProductPageTool: ToolDefinition = {
  name: "open_product_page",
  description:
    "Open a product's page for the customer (full photos and details). Use when they want to see more of a product or ask to open it. Pass the product name as shown, or its productId.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      product: { type: "string", description: 'Product name as shown, e.g. "Urban Trek Backpack".' },
      productId: { type: "string" },
    },
  },
  schema: productSchema,
  async execute(ctx, args) {
    const input = productSchema.parse(args);
    let productId = input.productId && isObjectId(input.productId) ? input.productId : null;
    if (!productId && input.product) productId = await productIdByName(ctx.session.storeId, input.product);
    const product = productId
      ? await prisma.product.findFirst({
          where: { id: productId, storeId: ctx.session.storeId, status: "active" },
          select: { name: true, slug: true },
        })
      : null;
    if (!product) return failure("product_not_found", "No single product matched. Ask which product they mean, by name.");
    return success({ opened: true, product: product.name, note: 'The page is opening. Say one short line, e.g. "Here it is."' }, [
      { type: "navigate", url: `/products/${product.slug}`, label: product.name },
    ]);
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
