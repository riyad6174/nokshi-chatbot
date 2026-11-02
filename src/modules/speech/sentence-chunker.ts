// Turns streamed reply text into speakable sentences, so text-to-speech can start on the first
// sentence while the model is still writing the rest.

const MIN_CHARS = 24;
const MAX_CHARS = 280;

/** Strips markdown and URLs that read badly aloud. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")
    .replace(/[*_`#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// End of sentence: . ! ? or the Bangla dari, then whitespace; or a line break.
const BOUNDARY = /([.!?।]+["')\]]?)\s+|\n+/g;

export function createSentenceChunker() {
  let buffer = "";

  const take = (final: boolean): string[] => {
    const sentences: string[] = [];
    let start = 0;
    let match: RegExpExecArray | null;
    BOUNDARY.lastIndex = 0;
    while ((match = BOUNDARY.exec(buffer)) !== null) {
      const end = match.index + (match[1]?.length ?? 0);
      const candidate = buffer.slice(start, end);
      // Short fragments ("Sure.") wait for the next sentence, except at a line break.
      if (toSpeakable(candidate).length >= MIN_CHARS || match[0].includes("\n")) {
        sentences.push(candidate);
        start = match.index + match[0].length;
      }
    }
    buffer = buffer.slice(start);
    // A long run without punctuation: cut at a space so speech doesn't stall.
    if (!final && buffer.length > MAX_CHARS) {
      const cut = buffer.lastIndexOf(" ", MAX_CHARS);
      if (cut > MIN_CHARS) {
        sentences.push(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 1);
      }
    }
    if (final && buffer.trim()) {
      sentences.push(buffer);
      buffer = "";
    }
    return sentences.map(toSpeakable).filter((sentence) => sentence.length > 0);
  };

  return {
    push: (text: string) => {
      buffer += text;
      return take(false);
    },
    flush: () => take(true),
  };
}
