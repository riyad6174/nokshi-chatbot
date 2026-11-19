import { describe, expect, it } from "vitest";
import { chunkDocument } from "@/modules/knowledge/retrieval.service";
import { historyAskedName, nextOrderStep } from "@/modules/ai/system-instructions";
import { getProviderTools } from "@/modules/ai/tools";
import { knowledgeSourcesFrom } from "@/modules/ai/tools/search-knowledge";
import { buildProviderHistory } from "@/modules/conversations/conversation.service";
import type { CartPayload } from "@/types/chat";

const empty: CartPayload = { cartId: "c", currency: "BDT", items: [], itemCount: 0, subtotalMinor: 0 };

describe("knowledge chunking", () => {
  it("keeps short documents whole and splits long ones near paragraph boundaries", () => {
    expect(chunkDocument("Delivery takes 2 days in Dhaka.")).toEqual(["Delivery takes 2 days in Dhaka."]);
    const long = Array.from({ length: 8 }, (_, index) => `Paragraph ${index}. ${"word ".repeat(40)}`).join("\n\n");
    const chunks = chunkDocument(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(810);
    expect(chunks.join("\n")).toContain("Paragraph 7.");
  });
});

describe("asking the name once", () => {
  it("stops asking once an earlier reply asked", () => {
    const history = [{ role: "assistant", content: "Sure! What should I call you?" }];
    expect(historyAskedName(history)).toBe(true);
    expect(historyAskedName([{ role: "user", content: "what is your name?" }])).toBe(false);
    expect(nextOrderStep({ cart: empty, savedDetails: null, openOrder: null })).toContain("Name unknown");
    expect(nextOrderStep({ cart: empty, savedDetails: null, openOrder: null, askedName: true })).not.toContain("Name unknown");
  });
});

describe("tools per turn", () => {
  const names = (state?: { cartItemCount: number; openOrder: boolean }) =>
    getProviderTools(null, state).map((tool) => tool.function.name);

  it("leaves out tools that can't succeed in the current state", () => {
    const emptyCart = names({ cartItemCount: 0, openOrder: false });
    expect(emptyCart).not.toContain("confirm_order");
    expect(emptyCart).not.toContain("remove_cart_item");
    expect(emptyCart).toContain("add_to_cart");
    expect(emptyCart).toContain("propose_order");
    expect(emptyCart).toContain("search_knowledge");

    const withCart = names({ cartItemCount: 2, openOrder: false });
    expect(withCart).toContain("remove_cart_item");
    expect(withCart).not.toContain("confirm_order");
    expect(names({ cartItemCount: 2, openOrder: true })).toContain("confirm_order");
    // No state (live voice): everything.
    expect(names()).toContain("confirm_order");
  });
});

describe("grounding across turns", () => {
  it("puts the policy excerpt a reply used into the next turn's history", () => {
    const sources = knowledgeSourcesFrom({ results: [{ title: "Shipping", excerpt: "Dhaka: 1-2 days. Outside Dhaka: 3-5 days." }] });
    const { history } = buildProviderHistory([
      {
        role: "assistant",
        content: "Delivery in Dhaka takes 1-2 days.",
        structuredContent: JSON.stringify([{ type: "text", text: "Delivery in Dhaka takes 1-2 days." }, { type: "knowledge_sources", sources }]),
        attachments: [],
        senderName: "",
        createdAt: new Date(),
      },
    ]);
    expect(history[0]!.content).toContain("Outside Dhaka: 3-5 days");
  });
});
