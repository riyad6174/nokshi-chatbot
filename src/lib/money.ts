export function formatMinor(minor: number, currency: string, locale = "en-BD"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(minor / 100);
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
