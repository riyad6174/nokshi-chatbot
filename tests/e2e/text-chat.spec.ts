import { expect, test, type Page } from "@playwright/test";

// The text chat itself: sending, the message bubbles, typing while a reply is coming, and reopening.
// Runs against the seeded demo store with the built-in demo assistant (no AI key).

// A fake microphone, so a voice call can start (used by the call-to-text test; harmless elsewhere).
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

async function openTextChat(page: Page, path = "/") {
  await page.goto(path);
  // The launcher opens the voice panel; switching to the text chat ends any call.
  await page.getByRole("button", { name: "Talk to the AI shopping assistant" }).click();
  await page.getByRole("button", { name: "Open text chat" }).click({ timeout: 60_000 });
  const composer = page.getByPlaceholder(/Ask me anything/);
  await expect(composer).toBeEnabled({ timeout: 60_000 });
  return composer;
}

const userBubbles = (page: Page, text: string) => page.locator(".bubble-user", { hasText: text });

test("sending clears the box, shows the message once, and keeps the bubble as the reply arrives", async ({ page }) => {
  const composer = await openTextChat(page);

  await composer.fill("Show me bags");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  // Typing stays possible while the reply is coming.
  await expect(composer).toBeEnabled();
  await expect(userBubbles(page, "Show me bags")).toHaveCount(1);

  // Mark the bubble: if it were re-created when the server confirms it, the mark would be gone.
  await userBubbles(page, "Show me bags").evaluate((element) => element.setAttribute("data-e2e-mark", "kept"));
  await expect(page.getByTestId("product-card").filter({ hasText: "Everyday Canvas Tote" }).last()).toBeVisible();
  await expect(page.locator('.bubble-user[data-e2e-mark="kept"]')).toHaveCount(1);
  await expect(userBubbles(page, "Show me bags")).toHaveCount(1);
});

test("a message sent while a reply is coming waits its turn, and both are answered in order", async ({ page }) => {
  const composer = await openTextChat(page);

  await composer.fill("Show me bags");
  await composer.press("Enter");
  // Straight away, before the first reply is done.
  await composer.fill("Show me wireless earbuds");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");

  await expect(userBubbles(page, "Show me bags")).toHaveCount(1);
  await expect(userBubbles(page, "Show me wireless earbuds")).toHaveCount(1);
  await expect(page.getByTestId("product-card").filter({ hasText: "Wireless Earbuds Pro" }).last()).toBeVisible({ timeout: 30_000 });

  const order = await page.locator(".bubble-user").allTextContents();
  expect(order.findIndex((text) => text.includes("Show me bags"))).toBeLessThan(order.findIndex((text) => text.includes("Show me wireless earbuds")));
});

test("reopening the chat shows each message once", async ({ page }) => {
  const composer = await openTextChat(page);
  await composer.fill("Show me bags");
  await composer.press("Enter");
  await expect(page.getByTestId("product-card").filter({ hasText: "Everyday Canvas Tote" }).last()).toBeVisible();

  await openTextChat(page);
  await expect(userBubbles(page, "Show me bags")).toHaveCount(1);
  await expect(page.getByTestId("product-card").filter({ hasText: "Everyday Canvas Tote" })).not.toHaveCount(0);
});

test.describe("switching from a call to the text chat", () => {
  test("ends the call, and typed messages get typed replies", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Talk to the AI shopping assistant" }).click();
    await expect(page.getByRole("button", { name: "End call" })).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Open text chat" }).click();
    await expect(page.getByRole("button", { name: "End call" })).toHaveCount(0);
    const composer = page.getByPlaceholder(/Ask me anything/);
    await expect(composer).toBeEnabled();
    await composer.fill("Show me bags");
    await composer.press("Enter");
    await expect(page.locator(".bubble-user", { hasText: "Show me bags" })).toHaveCount(1);
    await expect(page.getByTestId("product-card").filter({ hasText: "Everyday Canvas Tote" }).last()).toBeVisible();
  });
});
