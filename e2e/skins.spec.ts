import { expect, test } from "@playwright/test";
import { E2E_SKINS } from "./test.ts";

// Uses the plain Playwright `test` (no forced skin) to exercise selection and persistence.
test("skins: ?skin= on first load, switcher persists across reloads, every skin styles the app and its favicon", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "default", "skin switching only needs one project");
  const skinOf = () => page.evaluate(() => document.documentElement.dataset.skin);
  const favicon = page.locator('link[rel~="icon"]');

  await page.goto("/?skin=matte");
  await expect.poll(skinOf).toBe("matte");
  await page.goto("/");
  await expect.poll(skinOf).toBe("matte");

  const select = page.getByTestId("skin-select");
  await expect(select.locator("option")).toHaveCount(E2E_SKINS.length);
  const looks = new Set<string>();
  const icons = new Set<string>();
  for (const skin of E2E_SKINS) {
    await select.selectOption(skin);
    await expect.poll(skinOf).toBe(skin);
    await page.reload();
    await expect.poll(skinOf).toBe(skin);
    await expect(select).toHaveValue(skin);
    looks.add(
      await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const button = document.querySelector("button");
        const b = button ? getComputedStyle(button) : null;
        return [body.backgroundColor, body.fontFamily, b?.borderRadius, b?.backgroundColor].join("|");
      }),
    );
    // The favicon is the wordmark's "m" drawn in this skin's style.
    await expect(favicon).toHaveAttribute("data-skin", skin);
    const href = await favicon.getAttribute("href");
    expect(href).toMatch(/^data:image\/png;base64,/);
    icons.add(href!);
  }
  expect(looks.size).toBe(E2E_SKINS.length);
  expect(icons.size).toBe(E2E_SKINS.length);
});
