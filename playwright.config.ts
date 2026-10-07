import { defineConfig, devices } from "@playwright/test";
import { services } from "./scripts/services.ts";

/**
 * Browser end-to-end tests. Runs isolated servers on their own ports against the
 * `memegen_e2e` database and `.data/e2e-storage`, so a running `bun run dev` is untouched.
 */
const API_PORT = 4100;
const STORAGE_PORT = 4101;
const WEB_PORT = 5174;

export const E2E_ENV = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/memegen_e2e",
  API_PORT: String(API_PORT),
  STORAGE_PORT: String(STORAGE_PORT),
  WEB_PORT: String(WEB_PORT),
  // Pinned so an API_URL/STORAGE_URL override in the caller's config can't point Vite at another stack.
  API_URL: `http://localhost:${API_PORT}`,
  STORAGE_URL: `http://localhost:${STORAGE_PORT}`,
  STORAGE_PROVIDER: "local",
  LOCAL_STORAGE_DIR: ".data/e2e-storage",
  INTERNAL_TOKEN: "e2e-internal-token",
  // Specs sign in through the dev login.
  MODE: "dev",
};

const serverEnv = { ...process.env, ...E2E_ENV } as Record<string, string>;

export default defineConfig({
  testDir: "e2e",
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
