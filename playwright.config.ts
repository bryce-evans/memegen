import { defineConfig, devices } from "@playwright/test";
import { services } from "./scripts/services.ts";

import { E2E_ENV, WEB_PORT } from "./e2e/environment.ts";

const serverEnv = { ...process.env, ...E2E_ENV } as Record<string, string>;

export default defineConfig({
  testDir: "e2e",
  testIgnore: "library-gallery.spec.ts",
  // Shared database: run specs one at a time, in file order.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Branded Chrome ships the H.264/AAC codecs WebCodecs needs for MP4 export;
  // Playwright's bundled Chromium does not. Override with E2E_CHANNEL=chromium.
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL ?? "chrome" } }],
  webServer: services({ watch: false, web: "vite" }, serverEnv).map((s) => ({
    command: [s.command, ...s.args].join(" "),
    cwd: s.cwd,
    port: s.port,
    env: serverEnv,
    reuseExistingServer: false,
  })),
});
