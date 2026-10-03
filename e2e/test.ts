import { test as base, expect } from "@playwright/test";

/** Skins the suite runs under; mirrors `SKIN_IDS` in @memegen/ui. */
export const E2E_SKINS = ["default", "apple", "matte", "google", "studio", "spectrum"] as const;
export type E2ESkin = (typeof E2E_SKINS)[number];

/** `test` with a per-project `skin` option, applied before any app script runs. */
export const test = base.extend<{ skin: E2ESkin }>({
  skin: ["default", { option: true }],
  page: async ({ page, skin }, use) => {
    await page.addInitScript((s) => localStorage.setItem("memegen.skin", s), skin);
    await use(page);
  },
});

export { expect };

/** Unique per project, so every skin's run can share one database. */
export function scoped(name: string): string {
  return `${name}-${test.info().project.name}`;
}
