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
/** Whether a transcript has any words or digits at all (an empty one is usually a cough or a click). */
export function hasSpeechText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

// Speech recognition turns background noise and the assistant's own echo into stray words, often in
// other languages ("¿Qué", "de", "A", "la acción de", "जी"). Customers here speak Bangla or English
// (Bangla script, or Bangla/English in plain Latin letters), so these can't be them.

/** Latin letters with accents: Spanish/French/Portuguese guesses, never typed or said by customers here. */
const ACCENTED_LATIN = /[àáâãäåçèéêëìíîïñòóôõöùúûüýÿ¿¡]/i;
/** Letters that are neither Latin nor Bangla (Devanagari, Arabic, Cyrillic, …). */
const OTHER_SCRIPT = /[^\p{Script=Latin}\p{Script=Bengali}\P{L}]/u;
/** Function words of the languages noise gets transcribed as; never a whole customer sentence here. */
const FOREIGN_FUNCTION_WORDS = new Set([
  "a", "de", "la", "le", "les", "el", "los", "las", "del", "des", "du", "y", "que", "voy", "una", "une", "un",
  "por", "para", "con", "et", "est", "en", "se", "lo", "al",
]);
/** A lone token that is only noise when it's all that was heard. */
const LONE_FILLERS = new Set(["a", "e", "o", "i", "de", "la", "y", "el", "le", "pai", "que", "uh", "um"]);

/**
 * Whether a transcript is noise or echo rather than the customer: empty, in a foreign script or
 * accented Latin, a lone filler syllable, or mostly Spanish/French function words. Real short answers
 * ("না", "হ্যাঁ", "ok", "Large", "01796444356") are kept.
 */
export function isNoiseTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (!hasSpeechText(trimmed)) return true;
  if (ACCENTED_LATIN.test(trimmed) || OTHER_SCRIPT.test(trimmed)) return true;
  if (/[\p{Script=Bengali}\p{N}]/u.test(trimmed)) return false;
  const latin = trimmed
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (latin.length === 0) return false;
  if (latin.length === 1) return LONE_FILLERS.has(latin[0]!);
  const foreign = latin.filter((word) => FOREIGN_FUNCTION_WORDS.has(word)).length;
  return foreign / latin.length >= 0.5;
}

export function isLikelyEcho(heard: string, assistantSaid: string): boolean {
  const heardWords = words(heard);
  if (heardWords.length < MIN_WORDS || !assistantSaid.trim()) return false;
  const said = new Set(words(assistantSaid));
  const repeated = heardWords.filter((word) => said.has(word)).length;
  return repeated / heardWords.length >= ECHO_RATIO;
}
