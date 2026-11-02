// Speech recognition in Bangla writes numbers in Bangla digits (০১৭১২...), and often writes spoken
// digits as words ("জিরো ওয়ান ৭৯৪...", "শূন্য এক...", "zero one..."). Phone validation, lookups and
// storage use ASCII digits, so convert first.

const BANGLA_ZERO = 0x09e6;

export function toAsciiDigits(text: string): string {
  return text.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - BANGLA_ZERO));
}

/** Digits only, Bangla digits converted: "০১৭১২-৩৪৫ ৬৭৮" -> "01712345678". */
export function phoneDigits(text: string): string {
  return toAsciiDigits(text).replace(/\D/g, "");
}

// Digit words as speech recognition writes them: English, English in Bangla letters, and Bangla.
// Keys are NFC-normalized ("য়" has two Unicode spellings) and looked up the same way.
const DIGIT_WORDS = new Map(
  Object.entries({
    zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
    জিরো: "0", ওয়ান: "1", টু: "2", থ্রি: "3", ফোর: "4", ফাইভ: "5", সিক্স: "6", সেভেন: "7", এইট: "8", নাইন: "9",
    শূন্য: "0", শুন্য: "0", এক: "1", দুই: "2", তিন: "3", চার: "4", পাঁচ: "5", পাচ: "5", ছয়: "6", সাত: "7", আট: "8", নয়: "9",
  }).map(([word, digit]) => [word.normalize("NFC"), digit]),
);

const REPEAT_WORDS = new Map(
  Object.entries({ double: 2, ডাবল: 2, triple: 3, ট্রিপল: 3, ত্রিপল: 3 }).map(([word, times]) => [word.normalize("NFC"), times]),
);

function digitWord(token: string): string | undefined {
  return DIGIT_WORDS.get(token.trim().toLowerCase().replace(/[.,।]/g, "").normalize("NFC"));
}

/** Replaces spoken digit words with digits, including "double three" -> "33". Keeps everything else. */
function convertDigitWords(text: string): string {
  const tokens = toAsciiDigits(text).split(/(\s+|-)/);
  const out: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const times = REPEAT_WORDS.get(token.trim().toLowerCase().normalize("NFC"));
    if (times) {
      // The word after "double" (skipping the space) is the digit to repeat.
      const next = tokens[index + 2] ?? "";
      const digit = digitWord(next) ?? (/^\d$/.test(next.trim()) ? next.trim() : undefined);
      if (digit) {
        out.push(digit.repeat(times));
        index += 2;
        continue;
      }
    }
    out.push(digitWord(token) ?? token);
  }
  return out.join("");
}

/**
 * A phone number as said aloud -> digits: "জিরো ওয়ান 794283380" -> "01794283380". Typed numbers
 * pass through unchanged apart from Bangla digits, and a leading "+" is kept.
 */
export function spokenPhone(text: string): string {
  const converted = convertDigitWords(text);
  const digits = converted.replace(/\D/g, "");
  if (digits.length < 8) return text.trim();
  return `${converted.trim().startsWith("+") ? "+" : ""}${digits}`;
}

const BD_MOBILE = /^(?:880)?01[3-9]\d{8}$/;

/** A Bangladeshi mobile number (01XXXXXXXXX, optionally with 880) once spoken digits are converted. */
export function isBdMobile(phone: string): boolean {
  return BD_MOBILE.test(phoneDigits(spokenPhone(phone)));
}

/**
 * Finds a mobile number inside a sentence as speech recognition writes it, e.g.
 * "আমার নাম রহিম আর ফোন নম্বর জিরো ওয়ান 794283380" -> "01794283380". Null when there isn't one.
 */
export function findPhoneNumber(text: string): string | null {
  const converted = convertDigitWords(text);
  for (const match of converted.matchAll(/\+?[\d][\d\s-]{7,20}\d/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (BD_MOBILE.test(digits)) return digits.startsWith("880") ? `+${digits}` : digits;
  }
  return null;
}
