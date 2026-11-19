import { describe, expect, it } from "vitest";
import { runSerialized } from "@/modules/conversations/turn-queue";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("one turn at a time per conversation", () => {
  it("runs a second message's turn after the first finishes", async () => {
    const order: string[] = [];
    const first = runSerialized("c1", new AbortController().signal, async (waited) => {
      order.push(`first start waited=${waited}`);
      await tick(30);
      order.push("first end");
    });
    const second = runSerialized("c1", new AbortController().signal, async (waited) => {
      order.push(`second start waited=${waited}`);
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first start waited=false", "first end", "second start waited=true"]);
  });

  it("doesn't make other conversations wait", async () => {
    const order: string[] = [];
    const slow = runSerialized("a", new AbortController().signal, async () => {
      await tick(30);
      order.push("a");
    });
    const fast = runSerialized("b", new AbortController().signal, async () => {
      order.push("b");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["b", "a"]);
  });

  it("skips a queued turn whose request was cancelled, and stops waiting on a stuck one", async () => {
    const ran: string[] = [];
    const stuck = runSerialized("c2", new AbortController().signal, () => tick(200).then(() => undefined));
    const controller = new AbortController();
    const cancelled = runSerialized("c2", controller.signal, async () => {
      ran.push("cancelled");
    });
    controller.abort();
    const impatient = runSerialized("c2", new AbortController().signal, async () => {
      ran.push("impatient");
    }, 20);
    await Promise.all([cancelled, impatient]);
    expect(ran).toEqual(["impatient"]);
    await stuck;
  });
});
