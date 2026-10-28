import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { variantAvailable, variantPriceMinor, type ProductWithVariants } from "@/modules/catalog/product.service";
import type { CartPayload } from "@/types/chat";
import { isObjectId } from "@/lib/db/ids";

const cartInclude = {
  items: {
    include: {
      product: { include: { variants: true } },
      variant: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export class CartError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CartError";
    this.code = code;
    this.details = details;
  }
}

function buildSummary(cart: CartWithItems): CartPayload {
  const items = cart.items.map((item) => {
    const product = item.product;
    const variant = item.variant;
    const currentPrice = variantPriceMinor(product, variant);
    const available = variant
      ? variantAvailable(variant)
      : product.status === "active" && (product.variants.length === 0 || product.variants.some(variantAvailable));
    return {
      itemId: item.id,
      productId: product.id,
      variantId: item.productVariantId,
      name: product.name,
      variantTitle: variant?.title ?? null,
      sku: variant?.sku ?? null,
      imageUrl: product.imageUrl,
      quantity: item.quantity,
      unitPriceMinor: currentPrice,
      lineTotalMinor: currentPrice * item.quantity,
      available,
    };
  });

  return {
    cartId: cart.id,
    currency: cart.currency,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalMinor: items.reduce((sum, item) => sum + item.lineTotalMinor, 0),
  };
}

export async function getActiveCart(sessionId: string, storeId: string) {
  return prisma.cart.findFirst({
    where: { sessionId, storeId, status: "active" },
    include: cartInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrCreateActiveCart(sessionId: string, storeId: string, currency: string) {
  const existing = await getActiveCart(sessionId, storeId);
  if (existing) return existing;
  return prisma.cart.create({
    data: { sessionId, storeId, currency, status: "active" },
    include: cartInclude,
  });
}

export async function getCartSummary(sessionId: string, storeId: string, currency: string): Promise<CartPayload> {
  const cart = await getOrCreateActiveCart(sessionId, storeId, currency);
  return buildSummary(cart);
}

export async function getCartSummaryByCartId(cartId: string, storeId: string): Promise<CartPayload | null> {
  if (!isObjectId(cartId)) return null;
  const cart = await prisma.cart.findFirst({ where: { id: cartId, storeId }, include: cartInclude });
  return cart ? buildSummary(cart) : null;
}

export async function getCartForCheckout(sessionId: string, storeId: string) {
  const cart = await prisma.cart.findFirst({
    where: { sessionId, storeId, status: "active" },
    include: cartInclude,
    orderBy: { createdAt: "desc" },
  });
  if (!cart) return null;
  return cart;
}

function resolveVariant(product: ProductWithVariants, variantId?: string | null) {
  if (variantId) {
    const variant = product.variants.find((entry) => entry.id === variantId);
    if (!variant) {
      throw new CartError("variant_not_found", "That variant does not belong to this product.");
    }
    return variant;
  }
  if (product.variants.length === 0) return null;
  if (product.variants.length === 1) return product.variants[0];
  throw new CartError("variant_required", "This product has multiple variants. Ask the customer to choose one.", {
    variants: product.variants.map((variant) => ({ id: variant.id, title: variant.title, priceMinor: variantPriceMinor(product, variant) })),
  });
}

export async function addItem(input: {
  sessionId: string;
  storeId: string;
  currency: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
}): Promise<CartPayload> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
    throw new CartError("invalid_quantity", "Quantity must be a whole number between 1 and 99.");
  }

  if (!isObjectId(input.productId)) {
    throw new CartError("product_not_found", "That product is not available in this store.");
  }
  if (input.variantId && !isObjectId(input.variantId)) {
    throw new CartError("variant_not_found", "That variant does not belong to this product.");
  }

  const product = await prisma.product.findFirst({
    where: { id: input.productId, storeId: input.storeId, status: "active" },
    include: { variants: true },
  });
  if (!product) {
    throw new CartError("product_not_found", "That product is not available in this store.");
  }

  const variant = resolveVariant(product, input.variantId);
  if (variant && !variantAvailable(variant)) {
    throw new CartError("variant_unavailable", "That variant is currently out of stock.");
  }

  const cart = await getOrCreateActiveCart(input.sessionId, input.storeId, input.currency);
  const existing = cart.items.find(
    (item) => item.productId === product.id && item.productVariantId === (variant?.id ?? null),
  );

  const nextQuantity = (existing?.quantity ?? 0) + input.quantity;
  if (nextQuantity > 99) {
    throw new CartError("quantity_limit", "You can add up to 99 units of a single variant.");
  }
  if (variant?.stockQuantity != null && nextQuantity > variant.stockQuantity) {
    throw new CartError("insufficient_stock", `Only ${variant.stockQuantity} unit(s) of that variant are in stock.`);
  }

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: nextQuantity, priceSnapshotMinor: variantPriceMinor(product, variant) },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        productVariantId: variant?.id ?? null,
        quantity: input.quantity,
        priceSnapshotMinor: variantPriceMinor(product, variant),
      },
    });
  }

  await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
  const updated = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude });
  return buildSummary(updated);
}

export async function updateItem(input: {
  sessionId: string;
  storeId: string;
  cartId: string;
  itemId: string;
  quantity: number;
}): Promise<CartPayload> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
    throw new CartError("invalid_quantity", "Quantity must be a whole number between 1 and 99.");
  }
  if (!isObjectId(input.cartId)) throw new CartError("cart_not_found", "No active cart was found for this session.");

  const cart = await prisma.cart.findFirst({
    where: { id: input.cartId, sessionId: input.sessionId, storeId: input.storeId },
    include: cartInclude,
  });
  if (!cart) throw new CartError("cart_not_found", "No active cart was found for this session.");

  const item = cart.items.find((entry) => entry.id === input.itemId);
  if (!item) throw new CartError("item_not_found", "That cart item was not found.");

  if (item.variant?.stockQuantity != null && input.quantity > item.variant.stockQuantity) {
    throw new CartError(
      "insufficient_stock",
      `Only ${item.variant.stockQuantity} unit(s) of that variant are in stock.`,
    );
  }

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: input.quantity } });
  await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
  const updated = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude });
  return buildSummary(updated);
}

export async function removeItem(input: {
  sessionId: string;
  storeId: string;
  cartId: string;
  itemId: string;
}): Promise<CartPayload> {
  if (!isObjectId(input.cartId)) throw new CartError("cart_not_found", "No active cart was found for this session.");
  const cart = await prisma.cart.findFirst({
    where: { id: input.cartId, sessionId: input.sessionId, storeId: input.storeId },
    include: cartInclude,
  });
  if (!cart) throw new CartError("cart_not_found", "No active cart was found for this session.");

  const item = cart.items.find((entry) => entry.id === input.itemId);
  if (!item) throw new CartError("item_not_found", "That cart item was not found.");

  await prisma.cartItem.delete({ where: { id: item.id } });
  await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
  const updated = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude });
  return buildSummary(updated);
}

export { buildSummary };
