// Dates and times for the admin, always in the store's local time zone. Pages render on the server,
// whose clock is usually UTC on a host: formatting without an explicit zone showed Dhaka admins
// times six hours off. ADMIN_TIME_ZONE overrides the default (an IANA name like "Asia/Dhaka").

const FALLBACK_ZONE = "Asia/Dhaka";

function zone(): string {
  const configured = process.env.ADMIN_TIME_ZONE?.trim();
  if (!configured) return FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: configured });
    return configured;
  } catch {
    return FALLBACK_ZONE;
  }
}

function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** yyyy-mm-dd of the date in the store's zone (for "today" / "yesterday" comparisons). */
function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** "3:45 PM" */
export function formatTime(value: Date | string | number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone(), hour: "numeric", minute: "2-digit" }).format(asDate(value));
}

/** "24 Nov 2026" */
export function formatDate(value: Date | string | number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone(), day: "numeric", month: "short", year: "numeric" }).format(asDate(value));
}

/** "24 Nov 2026, 3:45 PM" */
export function formatDateTime(value: Date | string | number): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/**
 * When a message was sent, as people read it in a chat: "3:45 PM" today, "Yesterday, 3:45 PM",
 * "24 Nov, 3:45 PM" this year, "24 Nov 2025, 3:45 PM" before that.
 */
export function formatMessageTime(value: Date | string | number, now: Date = new Date()): string {
  const date = asDate(value);
  const day = dayKey(date);
  if (day === dayKey(now)) return formatTime(date);
  if (day === dayKey(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${formatTime(date)}`;
  const sameYear = day.slice(0, 4) === dayKey(now).slice(0, 4);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone(),
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
  return `${datePart}, ${formatTime(date)}`;
}

/** Short age for lists: "now", "5m", "3h", then the message time ("Yesterday, 3:45 PM", "24 Nov, …"). */
export function formatAgo(value: Date | string | number, now: Date = new Date()): string {
  const date = asDate(value);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 6 * 3600) return `${Math.round(seconds / 3600)}h`;
  return formatMessageTime(date, now);
}
