import { describe, expect, it } from "vitest";
import { isLikelyEcho } from "@/modules/speech/echo";

describe("echo detection", () => {
  const said = "Hmm, I found two backpacks for you. The Urban Trek is water resistant and fits a 15 inch laptop.";

  it("drops a transcript that repeats what the assistant just said", () => {
    expect(isLikelyEcho("I found two backpacks for you the urban trek is water resistant", said)).toBe(true);
    expect(isLikelyEcho("আমি আপনার জন্য দুটি ব্যাগ পেয়েছি", "আমি আপনার জন্য দুটি ব্যাগ পেয়েছি। কোনটা পছন্দ?")).toBe(true);
  });

  it("keeps real customer speech, including short answers that reuse its words", () => {
    expect(isLikelyEcho("yes", said)).toBe(false);
    expect(isLikelyEcho("the urban trek please", said)).toBe(false);
    expect(isLikelyEcho("do you have it in black and what about shoes", said)).toBe(false);
    expect(isLikelyEcho("I found two backpacks for you", "")).toBe(false);
  });
});

describe("empty transcripts", () => {
  it("treats punctuation-only transcripts as no speech, and keeps any real word or digit", async () => {
    const { hasSpeechText } = await import("@/modules/speech/echo");
    expect(hasSpeechText("")).toBe(false);
    expect(hasSpeechText(" … . ")).toBe(false);
    expect(hasSpeechText("হ্যাঁ")).toBe(true);
    expect(hasSpeechText("না")).toBe(true);
    expect(hasSpeechText("1")).toBe(true);
    expect(hasSpeechText("ok")).toBe(true);
  });
});
