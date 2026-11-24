import { describe, expect, it } from "vitest";
import { getLiveCallTools, getProviderTools } from "@/modules/ai/tools";
import { geminiFunctionDeclarations } from "@/modules/realtime/gemini-live.service";
import { realtimeTools } from "@/modules/realtime/realtime.service";

describe("ending a voice call", () => {
  it("lets the assistant end a live call, never a text chat", () => {
    const names = (tools: Array<{ function: { name: string } }>) => tools.map((tool) => tool.function.name);
    expect(names(getLiveCallTools())).toContain("end_call");
    expect(names(getProviderTools())).not.toContain("end_call");
    expect(geminiFunctionDeclarations().map((tool) => tool.name)).toContain("end_call");
    expect(realtimeTools().map((tool) => tool.name)).toContain("end_call");
  });
});
