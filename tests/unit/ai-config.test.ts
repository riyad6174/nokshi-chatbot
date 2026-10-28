import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, lastFour } from "@/lib/crypto/secrets";
import { toAnthropicMessages, toAnthropicTools } from "@/modules/ai/anthropic.provider";
import { resolveAiStatus } from "@/modules/ai/config";

describe("stored secrets", () => {
  it("round-trips and never stores plaintext", () => {
    const sealed = encryptSecret("sk-ant-secret-1234");
    expect(sealed).not.toContain("sk-ant");
    expect(decryptSecret(sealed)).toBe("sk-ant-secret-1234");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same")); // random IV
    expect(lastFour("sk-ant-secret-1234")).toBe("1234");
  });

  it("returns null for tampered, malformed, or empty values", () => {
    const sealed = encryptSecret("value");
    const parts = sealed.split(":");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(decryptSecret(parts.join(":"))).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    expect(decryptSecret("")).toBeNull();
  });
});

describe("AI config resolution", () => {
  const base = { provider: "anthropic", model: "claude-opus-5-5", aiBaseUrl: "", aiApiKeyEncrypted: "", aiApiKeyLast4: "", aiEffort: "high" };

  it("uses a dashboard key over the environment and keeps the chosen effort", () => {
    const status = resolveAiStatus({ ...base, aiApiKeyEncrypted: encryptSecret("sk-ant-abcd"), aiApiKeyLast4: "abcd" });
    expect(status.keySource).toBe("dashboard");
    expect(status.config).toMatchObject({ kind: "anthropic", apiKey: "sk-ant-abcd", model: "claude-opus-5-5", effort: "high" });
  });

  it("stays in demo mode without a key, and flags a key it can't decrypt", () => {
    expect(resolveAiStatus(base).config).toBeNull();
    const broken = resolveAiStatus({ ...base, aiApiKeyEncrypted: "v1:bad:bad:bad" });
    expect(broken.config).toBeNull();
    expect(broken.keyUnreadable).toBe(true);
  });

  it("allows a keyless self-hosted endpoint on localhost only", () => {
    const local = resolveAiStatus({ ...base, provider: "ollama", model: "llama", aiBaseUrl: "http://localhost:11434/v1" });
    expect(local.config).toMatchObject({ kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", apiKey: "" });
    const remote = resolveAiStatus({ ...base, provider: "openai-compatible", model: "m", aiBaseUrl: "https://llm.example.com/v1" });
    expect(remote.config).toBeNull();
  });

  it("falls back to the preset base URL for OpenAI-compatible providers", () => {
    const status = resolveAiStatus({ ...base, provider: "groq", model: "m", aiApiKeyEncrypted: encryptSecret("gsk") });
    expect(status.config?.baseUrl).toBe("https://api.groq.com/openai/v1");
  });
});

describe("Anthropic message conversion", () => {
  it("moves system text out, replays raw blocks unchanged, and groups parallel tool results", () => {
    const raw = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "t1", name: "get_cart", input: {} },
      { type: "tool_use", id: "t2", name: "search_products", input: { query: "bag" } },
    ];
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "Rules" },
      { role: "user", content: "hi" },
      { role: "assistant", content: null, raw, tool_calls: [] },
      { role: "tool", tool_call_id: "t1", content: "{\"ok\":true}" },
      { role: "tool", tool_call_id: "t2", content: "{\"ok\":false}", isError: true },
    ]);

    expect(system).toBe("Rules");
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: "assistant", content: raw });
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "{\"ok\":true}" },
        { type: "tool_result", tool_use_id: "t2", content: "{\"ok\":false}", is_error: true },
      ],
    });
  });

  it("maps tool definitions to input_schema", () => {
    const [tool] = toAnthropicTools([
      { type: "function", function: { name: "get_cart", description: "d", parameters: { type: "object", properties: {} } } },
    ]);
    expect(tool).toEqual({ name: "get_cart", description: "d", input_schema: { type: "object", properties: {} } });
  });
});
