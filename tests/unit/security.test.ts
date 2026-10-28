import { afterEach, describe, expect, it, vi } from "vitest";
import { seal, unseal } from "@/lib/auth/tokens";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logging/logger";
import {
  UntrustedCheckoutUrlError,
  allowedCheckoutHosts,
  assertTrustedCheckoutUrl,
} from "@/modules/commerce/checkout-url";

describe("sealed widget tokens", () => {
  it("round-trips a payload", () => {
    expect(unseal(seal({ sid: "s1" }))).toMatchObject({ sid: "s1" });
  });

  it("rejects a tampered payload", () => {
    const token = seal({ sid: "s1" });
    const [, signature] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ sid: "someone-else" })).toString("base64url");
    expect(unseal(`${forgedBody}.${signature}`)).toBeNull();
  });

  it("rejects expired, empty, and malformed tokens", () => {
    expect(unseal(seal({ sid: "s1", exp: Date.now() - 1 }))).toBeNull();
    expect(unseal(undefined)).toBeNull();
    expect(unseal("not-a-token")).toBeNull();
  });
});

describe("checkout URL allowlist", () => {
  const store = { websiteDomain: "shop-a.example", trustedCheckoutHosts: JSON.stringify(["pay.shop-a.example"]) };

  it("allows the store domain, the app host, and admin-configured hosts", () => {
    expect(allowedCheckoutHosts(store)).toEqual(
      expect.arrayContaining(["shop-a.example", "localhost:3000", "pay.shop-a.example"]),
    );
    expect(() => assertTrustedCheckoutUrl("https://pay.shop-a.example/c/abc", store)).not.toThrow();
    expect(() => assertTrustedCheckoutUrl("http://localhost:3000/checkout/abc", store)).not.toThrow();
  });

  it.each([
    "https://evil.example/checkout",
    "https://shop-a.example.evil.example/checkout",
    "javascript:alert(1)",
    "data:text/html,hi",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertTrustedCheckoutUrl(url, store)).toThrow(UntrustedCheckoutUrlError);
  });
});

describe("rate limiter", () => {
  afterEach(() => vi.useRealTimers());

  it("blocks after the limit and resets after the window", () => {
    vi.useFakeTimers();
    const key = `test:${Math.random()}`;
    expect(checkRateLimit(key, 2, 1000).allowed).toBe(true);
    expect(checkRateLimit(key, 2, 1000).allowed).toBe(true);
    const blocked = checkRateLimit(key, 2, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    vi.advanceTimersByTime(1001);
    expect(checkRateLimit(key, 2, 1000).allowed).toBe(true);
  });
});

describe("logger redaction", () => {
  it("never writes secrets or tokens", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test.event", {
      apiKey: "sk-live-123",
      nested: { authorization: "Bearer abc", password: "hunter2", safe: "visible" },
      checkoutToken: "tok_123",
    });
    const line = spy.mock.calls[0]?.[0] as string;
    spy.mockRestore();
    expect(line).not.toMatch(/sk-live-123|Bearer abc|hunter2|tok_123/);
    expect(line).toContain("visible");
  });
});
