import { describe, expect, it } from "vitest";
import { opensCardStage, pickLatestActions } from "@/components/chat/FloatingActions";
import type { ChatMessage, ChatPart } from "@/types/chat";

const card = { type: "product_list", label: "Product details", products: [{ id: "p1", name: "Urban Trek Backpack", slug: "urban-trek-backpack" }] } as unknown as ChatPart;
const reply = (parts: ChatPart[]): ChatMessage => ({ id: "m1", role: "assistant", parts, createdAt: "2026-11-24T10:00:00.000Z" });

describe("product cards over the page", () => {
  it("opens the card stage for new cards", () => {
    expect(opensCardStage(pickLatestActions([reply([card])]))).toBe(true);
  });

  it("keeps a page the assistant just opened visible: its cards don't cover it", () => {
    const navigate: ChatPart = { type: "navigate", url: "/products/urban-trek-backpack", label: "Urban Trek Backpack" };
    // Either order: the card before or after the navigation in the same reply.
    expect(opensCardStage(pickLatestActions([reply([navigate, card])]))).toBe(false);
    expect(opensCardStage(pickLatestActions([reply([card, navigate])]))).toBe(false);
  });

  it("has nothing to open without cards", () => {
    expect(opensCardStage(pickLatestActions([]))).toBe(false);
  });
});
