import { beforeEach, describe, expect, it } from "vitest";
import { executeTool, toolNames } from "@/modules/ai/tools";
import { getCartSummary } from "@/modules/cart/cart.service";
import { newSession, resetDb, seedFixture, type Fixture } from "../helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

type ToolContent = { ok: boolean; error?: { code: string }; [key: string]: unknown };

async function run(name: string, args: unknown) {
  const session = await newSession();
  const result = await executeTool({ session }, name, typeof args === "string" ? args : JSON.stringify(args));
  return { session, result, content: result.content as ToolContent };
}

describe("tool executor", () => {
  it("exposes exactly the approved tool set", () => {
    expect([...toolNames].sort()).toEqual(
      [
        "add_to_cart",
        "get_cart",
        "get_product_details",
        "prepare_checkout",
        "remove_cart_item",
        "search_knowledge",
        "search_products",
        "update_cart_item",
        "save_customer_details",
        "get_order_status",
        "request_human",
        "propose_order",
        "confirm_order",
        "get_recommendations",
        "save_customer_profile",
        "collect_contact_details",
      ].sort(),
    );
  });

  it("rejects unknown tools, malformed JSON, and invalid arguments", async () => {
    expect((await run("run_sql", {})).content.error?.code).toBe("unknown_tool");
    expect((await run("add_to_cart", "{not json")).content.error?.code).toBe("invalid_arguments");
    expect((await run("add_to_cart", { productId: fx.products.scarf.id, quantity: -3 })).content.error?.code).toBe(
      "invalid_arguments",
    );
  });

  it("ignores a store or session id smuggled into tool arguments", async () => {
    const { session, result } = await run("add_to_cart", {
      productId: fx.products.foreign.id,
      storeId: fx.storeB.id,
      sessionId: "someone-else",
    });
    expect(result.ok).toBe(false);
    expect((result.content as ToolContent).error?.code).toBe("product_not_found");
    expect((await getCartSummary(session.sessionId, session.storeId, "BDT")).items).toEqual([]);
  });

  it("search_products returns only current-store products with UI cards", async () => {
    const { result } = await run("search_products", { query: "backpack" });
    expect(result.ok).toBe(true);
    const ui = result.ui?.find((part) => part.type === "product_list");
    expect(ui).toBeDefined();
    const ids = (ui as { products: Array<{ id: string }> }).products.map((p) => p.id);
    expect(ids).toEqual([fx.products.backpack.id]);
  });

  it("add_to_cart reports variant_required instead of guessing", async () => {
    const { result, content } = await run("add_to_cart", { productId: fx.products.backpack.id });
    expect(result.ok).toBe(false);
    expect(content.error?.code).toBe("variant_required");
  });

  it("prepare_checkout validates, shows the details form, and never returns a checkout URL", async () => {
    const session = await newSession();
    await executeTool({ session }, "add_to_cart", JSON.stringify({ productId: fx.products.scarf.id }));
    const result = await executeTool({ session }, "prepare_checkout", "{}");
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.content)).not.toMatch(/https?:\/\//);
    expect(result.ui?.map((part) => part.type)).toEqual(["cart_summary", "details_form"]);
  });
});
