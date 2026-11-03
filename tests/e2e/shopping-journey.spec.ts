import { expect, test, type Browser, type Page } from "@playwright/test";

// End-to-end journeys against the seeded demo store, with the built-in demo assistant (no AI key).

async function openAssistant(page: Page, path = "/") {
  await page.goto(path);
  // The launcher starts a voice call; these journeys switch to the text chat.
  await page.getByRole("button", { name: "Talk to the AI shopping assistant" }).click();
  await page.getByRole("button", { name: "Open text chat" }).click({ timeout: 60_000 });
  // Generous timeout: the dev server compiles routes on first request.
  await expect(page.getByPlaceholder(/Ask me anything/)).toBeEnabled({ timeout: 60_000 });
}

async function send(page: Page, text: string) {
  const composer = page.getByPlaceholder(/Ask me anything|Message our team/);
  await composer.fill(text);
  await composer.press("Enter");
}

const cartBar = (page: Page) => page.getByRole("button", { name: /^Cart · \d+ items?/ });

test("browse → refine → add → change quantity → details in chat → checkout → order → status in chat", async ({ page }) => {
  await openAssistant(page);

  // Topic badges are offered before the first message.
  await expect(page.getByRole("group", { name: "Suggested topics" })).toBeVisible();

  // Budget recommendation from the real catalog, with refine chips.
  await send(page, "Suggest a bag under 1500 taka");
  const tote = page.getByTestId("product-card").filter({ hasText: "Everyday Canvas Tote" }).last();
  await expect(tote).toBeVisible();
  await expect(page.getByTestId("product-card").filter({ hasText: "Urban Trek Backpack" })).toHaveCount(0);

  await tote.getByRole("button", { name: "Add" }).click();
  await expect(cartBar(page)).toHaveText(/Cart · 1 item\b/);
  await cartBar(page).click();
  await page.getByRole("button", { name: "Increase quantity of Everyday Canvas Tote" }).first().click();
  await expect(cartBar(page)).toHaveText(/Cart · 2 items/, { timeout: 30_000 });

  // Checkout in chat collects delivery details, then hands off to the checkout page.
  await send(page, "checkout");
  await page.getByLabel("Full name").fill("Rahim Uddin");
  await page.getByLabel("Phone").fill("01712345678");
  await page.getByLabel("Address").fill("House 4, Road 2, Dhanmondi");
  await page.getByRole("button", { name: "Continue to checkout" }).click();

  await page.waitForURL(/\/checkout\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Rahim Uddin"); // pre-filled from chat
  await expect(page.getByText(/Qty 2/)).toBeVisible();
  await page.getByRole("button", { name: /Place order/ }).click();

  await expect(page.getByRole("heading", { name: "Thank you, Rahim!" })).toBeVisible({ timeout: 30_000 });
  const orderNumber = (await page.locator("main .font-mono").first().textContent())!.trim();
  expect(orderNumber).toMatch(/^NB-/);

  // Back in the store: cart is closed, and the chat knows the order.
  await openAssistant(page);
  await expect(cartBar(page)).toHaveCount(0);
  await send(page, "What is my order status?");
  await expect(page.getByText(orderNumber).last()).toBeVisible();
  await expect(page.getByText("Order placed").last()).toBeVisible();
});

test("topic badge answers from store knowledge", async ({ page }) => {
  await openAssistant(page);
  await page.getByRole("button", { name: "Delivery time" }).click();
  await expect(page.getByText(/2-3 business days/).last()).toBeVisible();
});

test("opening the chat on a product page greets with that product's overview", async ({ page }) => {
  await openAssistant(page, "/products/urban-trek-backpack");
  await expect(page.getByText(/looking at Urban Trek Backpack/).first()).toBeVisible();
  await expect(page.getByText(/Available in: Black, Olive/)).toBeVisible();
  await expect(page.getByTestId("product-card").filter({ hasText: "Urban Trek Backpack" })).toBeVisible();
});

async function adminPage(browser: Browser) {
  const context = await browser.newContext();
  const admin = await context.newPage();
  await admin.goto("/admin/login");
  await admin.getByLabel(/email/i).fill("admin@example.com");
  await admin.getByLabel(/password/i).fill("admin12345");
  await admin.getByRole("button", { name: /sign in|log in/i }).click();
  await admin.waitForURL(/\/admin$/);
  return admin;
}

test("handoff: customer asks for a person, an agent takes over from the Inbox and replies", async ({ page, browser }) => {
  test.slow(); // Two browser contexts and several cold-compiled admin pages.
  await openAssistant(page);
  await send(page, "I want to talk to a human");
  await expect(page.getByText(/A team member will reply here shortly/)).toBeVisible();

  const admin = await adminPage(browser);
  await admin.goto("/admin/inbox?filter=attention");
  await admin.getByRole("link", { name: /Customer asked for a person/ }).first().click();
  await admin.getByRole("button", { name: "Take over" }).click();
  await admin.getByLabel("Reply to customer").fill("Hi, this is the team. How can I help?");
  await admin.getByRole("button", { name: "Send" }).click();

  // Delivered to the customer by polling.
  await expect(page.getByText("Hi, this is the team. How can I help?")).toBeVisible({ timeout: 20_000 });
  await admin.context().close();
});

test("dashboard: configure chatbot tabs and AI model test without saving", async ({ browser }) => {
  test.slow();
  const admin = await adminPage(browser);
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Configure chatbot" }).click();
  await expect(admin.getByRole("heading", { name: "Configure chatbot" })).toBeVisible();
  await expect(admin.getByText(/active products?/)).toBeVisible();
  await admin.getByRole("link", { name: "Personality & greetings" }).click();
  await expect(admin.getByLabel("Tone")).toBeVisible();
  await expect(admin.getByLabel("Topic 1 badge text")).toHaveValue("Looking for a product");

  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "AI model" }).click();
  await expect(admin.getByText("Demo mode")).toBeVisible();
  await admin.getByLabel("Provider").selectOption("anthropic");
  await expect(admin.getByLabel("Model")).toHaveValue("claude-opus-5-5");
  await admin.getByRole("button", { name: "Test connection" }).click();
  await expect(admin.getByRole("status")).toHaveText(/Enter an API key/);
  await admin.context().close();
});

test("checkout link that does not exist shows 404, not a fake order", async ({ page }) => {
  const response = await page.goto("/checkout/not-a-real-token");
  expect(response?.status()).toBe(404);
});
