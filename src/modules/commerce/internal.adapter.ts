import { randomBytes } from "node:crypto";
import type { Store } from "@prisma/client";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import {
  getProductById,
  searchProducts,
  variantAvailable,
  variantPriceMinor,
} from "@/modules/catalog/product.service";
import { assertTrustedCheckoutUrl } from "@/modules/commerce/checkout-url";
import type {
  CheckoutLine,
  CheckoutLineIssue,
  CheckoutLineSnapshot,
  CommerceAdapter,
  CommerceProduct,
  PreparedCheckout,
} from "@/modules/commerce/commerce-adapter";
import { toCommerceProduct } from "@/modules/commerce/commerce-adapter";

export class CheckoutValidationError extends Error {
  issues: CheckoutLineIssue[];

  constructor(issues: CheckoutLineIssue[]) {
    super("Some cart items are no longer valid for checkout.");
    this.name = "CheckoutValidationError";
    this.issues = issues;
  }
}

async function loadLineProducts(storeId: string, lines: CheckoutLine[]) {
  const productIds = [...new Set(lines.map((line) => line.productId))];
  return prisma.product.findMany({
    where: { storeId, id: { in: productIds } },
    include: { variants: true },
  });
}

async function validateLines(storeId: string, lines: CheckoutLine[]) {
  const issues: CheckoutLineIssue[] = [];
  const products = await loadLineProducts(storeId, lines);
  const byId = new Map(products.map((product) => [product.id, product]));

  for (const line of lines) {
    const key = line.variantId ?? line.productId;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
      issues.push({ variantId: key, reason: "Quantity must be between 1 and 99." });
      continue;
    }
    const product = byId.get(line.productId);
    if (!product || product.status !== "active") {
      issues.push({ variantId: key, reason: "This product is no longer available." });
      continue;
    }
    if (line.variantId) {
      const variant = product.variants.find((entry) => entry.id === line.variantId);
      if (!variant) {
        issues.push({ variantId: key, reason: "This variant no longer exists." });
        continue;
      }
      if (!variantAvailable(variant)) {
        issues.push({ variantId: key, reason: "This variant is out of stock." });
        continue;
      }
      if (variant.stockQuantity != null && line.quantity > variant.stockQuantity) {
        issues.push({ variantId: key, reason: `Only ${variant.stockQuantity} unit(s) are in stock.` });
        continue;
      }
    } else if (product.variants.length > 0) {
      issues.push({ variantId: key, reason: "A variant must be selected for this product." });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function createInternalCommerceAdapter(store: Store): CommerceAdapter {
  return {
    async searchProducts(query): Promise<CommerceProduct[]> {
      const products = await searchProducts({
        storeId: store.id,
        text: query.text,
        category: query.category,
        maxPriceMinor: query.maxPriceMinor,
        limit: 8,
      });
      return products.map(toCommerceProduct);
    },

    async getProduct(productId): Promise<CommerceProduct | null> {
      const product = await getProductById(store.id, productId);
      return product ? toCommerceProduct(product) : null;
    },

    validateLines(lines) {
      return validateLines(store.id, lines);
    },

    async prepareCheckout(input): Promise<PreparedCheckout> {
      const validation = await validateLines(store.id, input.lines);
      if (!validation.valid) {
        throw new CheckoutValidationError(validation.issues);
      }

      const products = await loadLineProducts(store.id, input.lines);
      const byId = new Map(products.map((product) => [product.id, product]));
      const lines: CheckoutLineSnapshot[] = [];
      let subtotalMinor = 0;
      let currency = store.currency;

      for (const line of input.lines) {
        const product = byId.get(line.productId);
        if (!product) throw new CheckoutValidationError([{ variantId: line.productId, reason: "Unknown product." }]);
        const variant = line.variantId ? product.variants.find((entry) => entry.id === line.variantId) : null;
        const unitPriceMinor = variantPriceMinor(product, variant);
        const lineTotalMinor = unitPriceMinor * line.quantity;
        currency = product.currency;
        subtotalMinor += lineTotalMinor;
        lines.push({
          productId: product.id,
          variantId: variant?.id ?? null,
          name: product.name,
          variantTitle: variant?.title ?? null,
          sku: variant?.sku ?? null,
          quantity: line.quantity,
          unitPriceMinor,
          lineTotalMinor,
        });
      }

      const token = randomBytes(24).toString("base64url");
      const checkoutUrl = `${env.APP_BASE_URL.replace(/\/+$/, "")}/checkout/${token}`;
      assertTrustedCheckoutUrl(checkoutUrl, store);

      return {
        token,
        checkoutUrl,
        currency,
        subtotalMinor,
        lines,
      };
    },
  };
}
