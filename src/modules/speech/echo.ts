// The microphone can pick up the assistant's own voice from the speakers. A transcript that is
// mostly a repeat of what the assistant just said is that echo, not the customer.

const MIN_WORDS = 5;
const ECHO_RATIO = 0.75;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word.length > 1);
}

/**
 * True when most words of `heard` appear in what the assistant recently said. Short utterances
 * ("yes", "the black one") never count as echo, so real answers aren't dropped.
 */
export function isLikelyEcho(heard: string, assistantSaid: string): boolean {
  const heardWords = words(heard);
  if (heardWords.length < MIN_WORDS || !assistantSaid.trim()) return false;
  const said = new Set(words(assistantSaid));
  const repeated = heardWords.filter((word) => said.has(word)).length;
  return repeated / heardWords.length >= ECHO_RATIO;
}
