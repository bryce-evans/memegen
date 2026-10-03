import { test as base, expect } from "@playwright/test";
import { SKIN_IDS, type BuiltinSkinId } from "@memegen/ui/skin-ids";

/** Skins the suite runs under: every built-in skin. */
export const E2E_SKINS = SKIN_IDS;
export type E2ESkin = BuiltinSkinId;

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
