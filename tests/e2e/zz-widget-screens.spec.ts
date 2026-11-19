import { expect, test, type Page } from "@playwright/test";

// Temporary: layout check of product cards and cart in the chat widget. Deleted after use.
const OUT = "C:/Users/Riyad/AppData/Local/Temp/claude/30d12c30aeeef2b9/ed66593f-eb42-4fcb-9a03-6c3bf19888e2/scratchpad/widget";
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

/** Elements that stick out of the viewport or are cut off inside their own box. */
async function problems(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw) out.push(`page scrolls sideways by ${document.documentElement.scrollWidth - vw}px`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[role=dialog] *, [data-testid] *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      const label = `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
      if (r.right > vw + 1 || r.left < -1) out.push(`off-screen x=${Math.round(r.left)}..${Math.round(r.right)}: ${label}`);
      if (style.overflowX === "visible" && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0) out.push(`text overflows ${el.scrollWidth}>${el.clientWidth}: ${label}`);
    }
    return [...new Set(out)].slice(0, 12);
  });
}

const sizes = [["phone-sm", 360, 740], ["phone", 390, 844], ["tablet", 768, 1024], ["laptop", 1366, 657]] as const;

for (const [name, width, height] of sizes) {
  test(`widget ${name}`, async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop");
    test.setTimeout(300_000);
    const page = await (await browser.newContext({ viewport: { width, height }, hasTouch: width < 800, permissions: ["microphone"] })).newPage();
    const shot = async (step: string) => {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/${name}-${step}.png` });
      console.log("STEP", name, step, JSON.stringify(await problems(page)));
    };
    // Text chat.
    await page.goto("/");
    await page.getByRole("button", { name: "Talk to the AI shopping assistant" }).click();
    await page.getByRole("button", { name: "Open text chat" }).click({ timeout: 60_000 });
    const composer = page.getByLabel("Message the shopping assistant");
    await expect(composer).toBeEnabled({ timeout: 60_000 });
    await composer.fill("show me bags");
    await composer.press("Enter");
    await expect(page.getByTestId("product-card").first()).toBeVisible({ timeout: 45_000 });
    await shot("1-text-products");
    await page.getByTestId("product-card").first().getByRole("button", { name: "Add" }).click();
    await page.waitForTimeout(2500);
    await shot("2-text-added");
    const cartBar = page.getByRole("button", { name: /^Cart · \d+ items?/ });
    if (await cartBar.count()) { await cartBar.first().click(); await shot("3-text-cart"); }
  });
}

for (const [name, width, height] of sizes) {
  test(`voice stage ${name}`, async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop" || width > 800);
    test.setTimeout(300_000);
    const page = await (await browser.newContext({ viewport: { width, height }, hasTouch: true, permissions: ["microphone"] })).newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Talk to the AI shopping assistant" }).click();
    await expect(page.getByRole("button", { name: "End call" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Open text chat" }).click();
    await page.getByLabel("Message the shopping assistant").fill("Show me bags");
    await page.getByLabel("Message the shopping assistant").press("Enter");
    await page.getByRole("toolbar", { name: "Voice assistant controls" }).getByRole("button", { name: /Open voice assistant/ }).click();
    const stage = page.getByRole("dialog", { name: "Products and order" });
    await expect(stage.getByTestId("product-card").first()).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}-4-voice-products.png` });
    console.log("STEP", name, "4-voice-products", JSON.stringify(await problems(page)));
    await stage.getByTestId("product-card").first().getByRole("button", { name: "Add" }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${name}-5-voice-added.png` });
    console.log("STEP", name, "5-voice-added", JSON.stringify(await problems(page)));
  });
}
