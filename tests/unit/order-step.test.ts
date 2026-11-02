import { describe, expect, it } from "vitest";
import { nextOrderStep } from "@/modules/ai/system-instructions";
import type { CartPayload } from "@/types/chat";

const empty: CartPayload = { cartId: "c", currency: "BDT", items: [], itemCount: 0, subtotalMinor: 0 };
const withItem: CartPayload = {
  ...empty,
  itemCount: 1,
  subtotalMinor: 450000,
  items: [
    {
      itemId: "i", productId: "p", variantId: null, name: "Watch", variantTitle: null, sku: null, imageUrl: null,
      quantity: 1, unitPriceMinor: 450000, lineTotalMinor: 450000, available: true,
    },
  ],
};

describe("next step toward the order", () => {
  it("walks cart -> details -> summary -> confirm", () => {
    expect(nextOrderStep({ cart: empty, savedDetails: null, openOrder: null })).toContain("add_to_cart");
    const needsAddress = nextOrderStep({
      cart: withItem,
      savedDetails: { name: "Imran", phone: "01794283380", address: "", city: "", deliveryAreaId: "" },
      openOrder: null,
    });
    expect(needsAddress).toContain("delivery address");
    expect(needsAddress).not.toContain("phone number");
    expect(
      nextOrderStep({
        cart: withItem,
        savedDetails: { name: "Imran", phone: "01794283380", address: "Dhanmondi", city: "", deliveryAreaId: "" },
        openOrder: null,
      }),
    ).toContain("propose_order");
    expect(nextOrderStep({ cart: withItem, savedDetails: null, openOrder: "summary" })).toContain("confirm_order");
  });
});
