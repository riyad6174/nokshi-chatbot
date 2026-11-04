import { expect, test, type Browser, type Page } from "@playwright/test";

async function adminPage(browser: Browser) {
  const context = await browser.newContext();
  const admin = await context.newPage();
  await admin.goto("/admin/login");
  await admin.getByLabel(/email/i).fill("admin@example.com");
  await admin.getByLabel(/password/i).fill("admin12345");
  await admin.getByRole("button", { name: /sign in|log in/i }).click();
  await admin.waitForURL(/\/admin$/);
  // "Apply preset" and "Send" ask for confirmation.
  admin.on("dialog", (dialog) => void dialog.accept());
  return admin;
}

/** Submits a server-action form and waits until the redirected page has rendered. */
async function submit(page: Page, button: string) {
  const action = page.waitForResponse((response) => response.request().method() === "POST");
  await page.getByRole("button", { name: button }).click();
  await action;
  await page.waitForLoadState("networkidle");
}

test("AI Sales & Engagement: apply an industry preset, customise, preview, then restore", async ({ browser }) => {
  test.slow();
  const admin = await adminPage(browser);
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "AI Sales & Engagement" }).click();
  await expect(admin.getByRole("heading", { name: "AI Sales & Engagement" })).toBeVisible();

  await admin.getByLabel("Industry").selectOption("fashion");
  await submit(admin, "Apply preset");
  await expect(admin.getByText(/Current: Fashion & apparel/)).toBeVisible();
  await expect(admin.getByLabel("Acts as")).toHaveValue("a friendly personal stylist");

  await admin.getByLabel("Acts as").fill("Mina, your personal stylist");
  await submit(admin, "Save sales settings");
  await admin.reload();
  await expect(admin.getByLabel("Acts as")).toHaveValue("Mina, your personal stylist");

  // A bad relationship line is rejected with a clear message, and nothing is saved.
  await admin.getByLabel(/Product relationships/).fill("Shirts Pants");
  await submit(admin, "Save sales settings");
  await expect(admin.getByText(/Relationship line 1/)).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel(/Product relationships/)).toHaveValue(/Shirts -> Pants/);

  // Preview recommendations with the saved settings.
  await admin.getByLabel("Product", { exact: true }).selectOption({ index: 1 });
  await admin.getByRole("button", { name: "Preview" }).click();
  await expect(admin.getByRole("heading", { name: "Test recommendations" })).toBeVisible();

  // Back to the general preset so the shopping journey isn't affected by proactive messages.
  await admin.getByLabel("Industry").selectOption("general");
  await submit(admin, "Apply preset");
  await expect(admin.getByText(/Current: General store/)).toBeVisible();
  await admin.context().close();
});

test("Marketing and Analytics pages", async ({ browser }) => {
  test.slow();
  const admin = await adminPage(browser);
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Marketing" }).click();
  await expect(admin.getByRole("heading", { name: "Marketing" })).toBeVisible();
  await expect(admin.getByText(/Dry-run mode/)).toBeVisible();
  await admin.getByLabel("Name", { exact: true }).fill(`Cart reminder ${Date.now()}`);
  await submit(admin, "Create draft");
  await expect(admin.getByText("Campaign created as a draft.")).toBeVisible();

  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Analytics" }).click();
  await expect(admin.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(admin.getByText("Search → purchase")).toBeVisible();
  await admin.getByRole("navigation", { name: "Reporting period" }).getByRole("link", { name: "7 days" }).click();
  await expect(admin.getByText(/last 7 days/)).toBeVisible();
  await admin.context().close();
});
