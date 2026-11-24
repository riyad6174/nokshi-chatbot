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

  it("lets the placed-order card step aside once the customer asks something else", () => {
    const placed = { type: "order_status", orders: [{ orderNumber: "NB-1", status: "placed" }] } as unknown as ChatPart;
    const event: ChatMessage = { id: "e1", role: "event", parts: [placed], createdAt: "2026-11-24T10:00:01.000Z" };
    expect(pickLatestActions([reply([card]), event])?.parts.map((entry) => entry.part.type)).toEqual(["order_status"]);
    const asked: ChatMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "what else do you have?" }], createdAt: "2026-11-24T10:00:05.000Z" };
    const answer: ChatMessage = { id: "a2", role: "assistant", parts: [{ type: "text", text: "Bags, clothing…" }], createdAt: "2026-11-24T10:00:06.000Z" };
    // Neither the order card nor older cards (the products before it) stay on the stage.
    expect(pickLatestActions([reply([card]), event, asked, answer])).toBeNull();
  });

  it("keeps an open order summary while the customer asks about it", () => {
    const summary = { type: "order_confirmation", confirmation: { confirmationId: "c1" } } as unknown as ChatPart;
    const question: ChatMessage = { id: "u3", role: "user", parts: [{ type: "text", text: "is it cash on delivery?" }], createdAt: "2026-11-24T10:00:09.000Z" };
    expect(pickLatestActions([reply([summary]), question])?.parts.map((entry) => entry.part.type)).toEqual(["order_confirmation"]);
  });

  it("has nothing to open without cards", () => {
    expect(opensCardStage(pickLatestActions([]))).toBe(false);
  });
});
