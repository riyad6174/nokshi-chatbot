import { describe, expect, it } from "vitest";
import { createSentenceChunker, toSpeakable } from "@/modules/speech/sentence-chunker";
import { detectLang, toSpeechLang } from "@/modules/speech/speech-provider";

describe("sentence chunker", () => {
  it("releases a sentence as soon as it ends, keeping the rest buffered", () => {
    const chunker = createSentenceChunker();
    expect(chunker.push("I found three backpacks for you")).toEqual([]);
    expect(chunker.push(". The Trail Backpack is the best fit")).toEqual(["I found three backpacks for you."]);
    expect(chunker.flush()).toEqual(["The Trail Backpack is the best fit"]);
  });

  it("splits Bangla on the dari", () => {
    const chunker = createSentenceChunker();
    expect(chunker.push("আপনার জন্য তিনটি ব্যাগ পেয়েছি। কোন রঙ পছন্দ করবেন? ")).toEqual(["আপনার জন্য তিনটি ব্যাগ পেয়েছি।"]);
    // The short question waits for more text, and is spoken when the reply ends.
    expect(chunker.flush()).toEqual(["কোন রঙ পছন্দ করবেন?"]);
  });

  it("joins very short fragments with the next sentence instead of speaking them alone", () => {
    const chunker = createSentenceChunker();
    expect(chunker.push("Sure. ")).toEqual([]);
    expect(chunker.push("Here are the options I found for you. ")).toEqual(["Sure. Here are the options I found for you."]);
  });

  it("cuts long unpunctuated runs so speech doesn't stall", () => {
    const chunker = createSentenceChunker();
    const sentences = chunker.push(`${"word ".repeat(80)}`);
    expect(sentences.length).toBe(1);
    expect(sentences[0]!.length).toBeLessThanOrEqual(280);
  });

  it("strips markdown, list markers and links before speaking", () => {
    expect(toSpeakable("**Trail Backpack** - see [details](https://shop.example/p/1) https://x.example")).toBe(
      "Trail Backpack - see details",
    );
    expect(toSpeakable("1. Black\n- Olive")).toBe("Black Olive");
  });
});

describe("speech language", () => {
  it("detects Bangla script and falls back for numbers", () => {
    expect(detectLang("দাম কত?")).toBe("bn");
    expect(detectLang("How much is it?")).toBe("en");
    expect(detectLang("1200", "bn")).toBe("bn");
  });

  it("maps locales", () => {
    expect(toSpeechLang("bn-BD")).toBe("bn");
    expect(toSpeechLang("en-US")).toBe("en");
    expect(toSpeechLang(undefined)).toBe("en");
  });
});
