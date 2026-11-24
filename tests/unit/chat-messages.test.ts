import { describe, expect, it } from "vitest";
import { mergeMessages, messageKey } from "@/components/chat/messages";
import type { ChatMessage } from "@/types/chat";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 24, 10, 0, seconds)).toISOString();
const msg = (id: string, role: ChatMessage["role"], text: string, seconds: number, localKey?: string): ChatMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
  createdAt: at(seconds),
  ...(localKey ? { localKey } : {}),
});

describe("keeping the chat in step with the server", () => {
  it("replaces the customer's message with its server copy, once, keeping the on-screen key", () => {
    const current = [msg("a1", "assistant", "Hi!", 0), msg("user-1", "user", "show bags", 5, "user-1")];
    const merged = mergeMessages(current, [msg("srv-u1", "user", "show bags", 6)]);
    expect(merged.map((message) => message.id)).toEqual(["a1", "srv-u1"]);
    expect(messageKey(merged[1]!)).toBe("user-1");
  });

  it("never adds a second copy of a reply that's already on screen", () => {
    const current = [msg("srv-u1", "user", "show bags", 1), msg("pending-1", "assistant", "Here are our bags.", 2, "pending-1")];
    const merged = mergeMessages(current, [msg("srv-u1", "user", "show bags", 1), msg("srv-a1", "assistant", "Here are our bags.", 3)]);
    expect(merged.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(messageKey(merged[1]!)).toBe("pending-1");
  });

  it("leaves a reply that is still streaming alone", () => {
    const current = [msg("user-2", "user", "hi", 1, "user-2"), msg("pending-2", "assistant", "", 2, "pending-2")];
    const inFlight = new Set(["user-2", "pending-2"]);
    const merged = mergeMessages(current, [msg("srv-u2", "user", "hi", 1)], { inFlight });
    // The stream swaps its own messages; the server copy waits.
    expect(merged.map((message) => message.id)).toEqual(["user-2", "pending-2"]);
  });

  it("reopening the chat: the server's history, in order, plus what's still being sent", () => {
    const current = [
      msg("srv-u1", "user", "order it", 1),
      msg("pending-9", "assistant", "Placed!", 3, "pending-9"), // finished, but never got its id
      msg("user-3", "user", "what else do you have?", 9, "user-3"), // queued
    ];
    const server = [msg("srv-e1", "event", "Order NB-1 placed.", 2), msg("srv-u1", "user", "order it", 1), msg("srv-a1", "assistant", "Placed!", 3)];
    const merged = mergeMessages(current, server, { full: true, inFlight: new Set(["user-3"]) });
    expect(merged.map((message) => message.id)).toEqual(["srv-u1", "srv-e1", "srv-a1", "user-3"]);
    // The finished reply's bubble keeps its key: no second entrance animation.
    expect(messageKey(merged[2]!)).toBe("pending-9");
  });
});
