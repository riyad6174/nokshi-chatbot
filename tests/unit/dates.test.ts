import { describe, expect, it } from "vitest";
import { formatAgo, formatDateTime, formatMessageTime } from "@/lib/dates";

// Admin times are in the store's zone (Asia/Dhaka, UTC+6), whatever zone the server runs in.
describe("admin dates", () => {
  const now = new Date("2026-11-24T12:00:00Z"); // 6:00 PM on 24 Nov in Dhaka

  it("shows Dhaka time, not the server's UTC", () => {
    expect(formatDateTime("2026-11-24T09:15:00Z")).toBe("24 Nov 2026, 3:15 PM");
    // 18:30 UTC is already the next day in Dhaka.
    expect(formatDateTime("2026-11-23T18:30:00Z")).toBe("24 Nov 2026, 12:30 AM");
  });

  it("reads like a chat: today, yesterday, this year, older", () => {
    expect(formatMessageTime("2026-11-24T09:15:00Z", now)).toBe("3:15 PM");
    expect(formatMessageTime("2026-11-23T09:15:00Z", now)).toBe("Yesterday, 3:15 PM");
    expect(formatMessageTime("2026-10-02T09:15:00Z", now)).toBe("2 Oct, 3:15 PM");
    expect(formatMessageTime("2025-10-02T09:15:00Z", now)).toBe("2 Oct 2025, 3:15 PM");
  });

  it("gives short ages in lists", () => {
    expect(formatAgo("2026-11-24T11:59:30Z", now)).toBe("now");
    expect(formatAgo("2026-11-24T11:40:00Z", now)).toBe("20m");
    expect(formatAgo("2026-11-24T09:00:00Z", now)).toBe("3h");
    expect(formatAgo("2026-11-23T09:15:00Z", now)).toBe("Yesterday, 3:15 PM");
  });
});
