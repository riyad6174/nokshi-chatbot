import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      // Separate database and build folder so the E2E run never touches dev data.
      // Starts an in-memory MongoDB, pushes the schema, seeds, then runs `next dev` against it.
      command: "node scripts/e2e-server.mjs",
      url: BASE_URL,
      // DB sync + seed + a cold `next dev` compile can take several minutes on a busy machine.
      timeout: 600_000,
      reuseExistingServer: false,
      env: {
        PORT: String(PORT),
        NEXT_DIST_DIR: ".next-e2e",
        APP_BASE_URL: BASE_URL,
        AUTH_SECRET: "e2e-secret-0123456789abcdef",
        WIDGET_PUBLIC_KEY: "demo-widget-key",
        NEXT_PUBLIC_WIDGET_KEY: "demo-widget-key",
        // Empty key = deterministic demo assistant, so the journey doesn't depend on a live model.
        AI_API_KEY: "",
        COMMERCE_PROVIDER: "internal",
        COMMERCE_TRUSTED_HOSTS: "",
        ADMIN_EMAIL: "admin@example.com",
        ADMIN_PASSWORD: "admin12345",
      },
    },
  ],
});
