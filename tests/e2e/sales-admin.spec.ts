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

test("AI Sales & Engagement: language and assistant role are saved; advanced sections stay hidden", async ({ browser }) => {
  test.slow();
  const admin = await adminPage(browser);
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "AI Sales & Engagement" }).click();
  await expect(admin.getByRole("heading", { name: "AI Sales & Engagement" })).toBeVisible();

  // Simplified for now: presets, recommendation rules, proactive engagement and feature switches are hidden.
  await expect(admin.getByLabel("Industry")).toHaveCount(0);
  await expect(admin.getByText(/Turned off for now/)).toBeVisible();

  const role = admin.getByLabel("Acts as");
  const originalRole = await role.inputValue();
  await admin.getByLabel(/Bangla \(বাংলা\)/).check();
  await role.fill("Mina, your personal stylist");
  await submit(admin, "Save sales settings");
  await admin.reload();
  await expect(admin.getByLabel("Acts as")).toHaveValue("Mina, your personal stylist");
  await expect(admin.getByLabel(/Bangla \(বাংলা\)/)).toBeChecked();

  // Restore, so the other journeys run with the default language and role.
  await admin.getByLabel(/Match the customer/).check();
  await admin.getByLabel("Acts as").fill(originalRole);
  await submit(admin, "Save sales settings");
  await admin.reload();
  await expect(admin.getByLabel(/Match the customer/)).toBeChecked();
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
