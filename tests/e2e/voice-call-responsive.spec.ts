import { expect, test, type Page } from "@playwright/test";

// A real (fake-microphone) voice call: closing the panel must not end it, and on phones the cards
// the assistant shows must get most of the screen.
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

const startCall = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to the AI shopping assistant" }).click();
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible({ timeout: 60_000 });
};

const launcher = (page: Page) => page.getByRole("button", { name: "Voice call in progress, open assistant" });

const noSidewaysScroll = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};

test("closing the panel keeps the call running until it is ended", async ({ page }) => {
  await startCall(page);
  await page.getByRole("button", { name: "Minimize, the call continues" }).first().click();

  await expect(page.getByRole("dialog", { name: /voice assistant/ })).toHaveCount(0);
  await expect(launcher(page)).toBeVisible();
  await expect(launcher(page)).toHaveAttribute("data-call-state", /listening|hearing|thinking|speaking/);
  const controls = page.getByRole("toolbar", { name: "Voice assistant controls" });
  await expect(controls).toBeInViewport({ ratio: 1 });
  await noSidewaysScroll(page);

  // Reopening shows the same call; it isn't restarted.
  await launcher(page).click();
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  await page.getByRole("button", { name: "Minimize, the call continues" }).first().click();

  await controls.getByRole("button", { name: "End voice" }).click();
  await expect(controls).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Talk to the AI shopping assistant" })).toBeVisible();
});

test("cards get most of the screen while a call is on", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The slim bar is the small-screen layout.");
  await startCall(page);

  // Ask by text during the call, then go back to the voice view that shows the cards.
  await page.getByRole("button", { name: "Open text chat" }).click();
  await page.getByLabel("Message the shopping assistant").fill("Show me bags");
  await page.getByLabel("Message the shopping assistant").press("Enter");
  await page.getByRole("toolbar", { name: "Voice assistant controls" }).getByRole("button", { name: /Open voice assistant/ }).click();

  const stage = page.getByRole("dialog", { name: "Products and order" });
  await expect(stage.getByTestId("product-card").first()).toBeVisible({ timeout: 45_000 });
  const viewport = page.viewportSize()!;
  await expect.poll(async () => (await stage.boundingBox())?.height ?? 0).toBeGreaterThan(viewport.height * 0.7);
  await noSidewaysScroll(page);
  await page.screenshot({ path: "test-results/mobile-cards-during-call.png" });
});
