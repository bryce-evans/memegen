import { defineConfig, devices } from "@playwright/test";

/** File/local-fixture gallery tests: no database, app servers, search model, or AI stub. */
export default defineConfig({
  testDir: "e2e",
  testMatch: "library-gallery.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report/library" }]] : "list",
  outputDir: "test-results/library",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "library", use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL ?? "chrome" } }],
});
