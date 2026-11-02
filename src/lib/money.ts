export function formatMinor(minor: number, currency: string, locale = "en-BD"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * Price for the AI to say or write ("2,550 taka"). Tools give the model these labels instead of raw
 * minor units, which it would otherwise read out as e.g. "255000".
 */
export function priceLabel(minor: number, currency: string): string {
  const amount = (minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return currency === "BDT" ? `${amount} taka` : `${amount} ${currency}`;
}

export function takaToMinor(value: number): number {
  return Math.round(value * 100);
}

export function minorToMajor(minor: number): number {
  return minor / 100;
}

export function assertNonNegativeMinor(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Invalid money value: expected a non-negative integer in minor units.");
  }
  return value;
}
