import { expect, test, type Browser, type Page } from "@playwright/test";

// Admin inbox: the conversation as the customer saw it (real cards, customer left / AI right with
// badges, session dividers) and the "Show token usage" report, remembered across reloads.

test.skip(({ isMobile }) => isMobile, "Admin inbox is checked on desktop.");

async function openAssistant(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to the AI shopping assistant" }).click();
  await page.getByRole("button", { name: "Open text chat" }).click({ timeout: 60_000 });
  await expect(page.getByPlaceholder(/Ask me anything/)).toBeEnabled({ timeout: 60_000 });
}

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await context.newPage();
  await admin.goto("/admin/login");
  await admin.getByLabel(/email/i).fill("admin@example.com");
  await admin.getByLabel(/password/i).fill("admin12345");
  await admin.getByRole("button", { name: /sign in|log in/i }).click();
  await admin.waitForURL(/\/admin$/);
  return admin;
}

const geminiUsage = (audioIn: number, audioOut: number) => ({
  promptTokenCount: 4200 + audioIn,
  cachedContentTokenCount: 2100,
  candidatesTokenCount: audioOut + 40,
  thoughtsTokenCount: 60,
  totalTokenCount: 4200 + audioIn + audioOut + 100,
  promptTokensDetails: [
    { modality: "TEXT", tokenCount: 4200 },
    { modality: "AUDIO", tokenCount: audioIn },
  ],
  responseTokensDetails: [
    { modality: "TEXT", tokenCount: 40 },
    { modality: "AUDIO", tokenCount: audioOut },
  ],
});

test("inbox shows real cards, sides and badges, and the token report stays on", async ({ page, browser }, testInfo) => {
  test.setTimeout(600_000); // Cold-compiles the widget and several admin pages.
  await openAssistant(page);
  const composer = page.getByPlaceholder(/Ask me anything/);
  await composer.fill("show me bags");
  await composer.press("Enter");
  await expect(page.getByTestId("product-card").first()).toBeVisible({ timeout: 30_000 });

  // Usage reports the way a call sends them. The demo store has no live voice, so no transcript is
  // saved: the rows are matched to the AI reply just saved by time (the "estimated" path).
  for (const index of [0, 1]) {
    const response = await page.request.post("/api/widget/voice/realtime/usage", {
      data: { kind: "gemini", responseId: `e2e-call-${index}`, model: "gemini-3.8-live", usage: geminiUsage(300 + index * 200, 900 - index * 300), replyKey: `e2e-reply-${index}` },
    });
    expect(response.ok()).toBe(true);
  }

  const admin = await adminPage(browser);
  await admin.goto("/admin/inbox");
  await admin
    .locator('a[href^="/admin/inbox/"]')
    .filter({ hasText: /আর কিছু লাগবে|না, ধন্যবাদ|show me bags|Visitor/ })
    .first()
    .click({ timeout: 180_000 });

  // Real product cards, read-only; badges for both sides; a session divider.
  const timeline = admin.locator(".admin-light");
  await expect(timeline.getByTestId("product-card").first()).toBeVisible({ timeout: 30_000 });
  await expect(timeline.getByText(/^Customer · Visitor/).first()).toBeVisible();
  await expect(timeline.getByText("AI assistant").first()).toBeVisible();
  await expect(timeline.getByRole("separator", { name: "Session 1" })).toBeVisible();
  // Customer on the left, AI on the right.
  const customerBox = await timeline.getByText("show me bags", { exact: true }).boundingBox();
  const aiBox = await timeline.getByText("AI assistant").first().boundingBox();
  expect(customerBox && aiBox && customerBox.x < aiBox.x).toBe(true);
  // No token report until asked for.
  await expect(admin.getByRole("region", { name: "Token usage for this conversation" })).toHaveCount(0);
  await admin.screenshot({ path: `${process.env.E2E_SHOTS ?? testInfo.outputDir}/inbox-off.png`, fullPage: true });

  const toggle = admin.getByRole("switch", { name: /Show token usage/ });
  await toggle.click();
  const report = admin.getByRole("region", { name: "Token usage for this conversation" });
  await expect(report).toBeVisible({ timeout: 20_000 });
  await expect(report.getByText("Model requests")).toBeVisible();
  await expect(report.getByText(/2 matched by time/)).toBeVisible();
  await expect(timeline.getByText(/2 requests · .* tokens/).first()).toBeVisible();

  // Remembered after a reload.
  await admin.reload();
  await expect(admin.getByRole("switch", { name: /Show token usage/ })).toHaveAttribute("aria-checked", "true");
  await expect(report).toBeVisible();
  await admin.screenshot({ path: `${process.env.E2E_SHOTS ?? testInfo.outputDir}/inbox-on.png`, fullPage: true });
  await report.getByRole("button", { name: "Show as table" }).click();
  await expect(report.getByRole("columnheader", { name: "Audio out" })).toBeVisible();
  await admin.context().close();
});
