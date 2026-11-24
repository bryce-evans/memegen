import { expect, scoped, test } from "./test.ts";
import { readFileSync } from "node:fs";
import { editFixture, fixture, signIn, stagePixels } from "./helpers.ts";
import { E2E_ENV } from "./environment.ts";

test("upload caps are enforced before upload, with the reason shown", async ({ page }) => {
  await page.goto("/");
  await signIn(page, scoped("rulebreaker"));
  await page.getByTestId("nav-create").click();
  const input = page.getByTestId("new-template-file");
  await expect(input).toBeEnabled(); // waits for /storage/limits
  await input.setInputFiles(fixture("too-wide.gif"));
  await expect(page.getByTestId("new-template-error")).toContainText("1100x60");
  await expect(page.getByTestId("new-template-error")).toContainText("1024");
  await expect(page).toHaveURL(/\/create$/); // never reached the Template Editor
});

test("user font uploads are rejected while built-in fonts remain selectable", async ({ page, request }) => {
  const fontName = scoped("Built-in Font");
  const font = {
    name: "TitilliumWeb-Black.ttf",
    mimeType: "font/ttf",
    buffer: readFileSync(fixture("TitilliumWeb-Black.ttf")),
  };
  const seeded = await request.post(`${E2E_ENV.STORAGE_URL}/assets`, {
    headers: { "x-internal-token": E2E_ENV.INTERNAL_TOKEN },
    multipart: { file: font, name: fontName },
  });
  expect(seeded.status()).toBe(201);
  await editFixture(page, request, scoped("typographer"), "still.png");
  const rejected = await page.request.post("/storage/assets", {
    multipart: { file: { ...font, name: "disguised.png", mimeType: "image/png" } },
  });
  expect(rejected.status()).toBe(403);
  expect(await rejected.json()).toEqual({ error: "font uploads are not allowed" });
  await page.getByTestId("layer-item").first().getByTestId("layer-settings-toggle").click();
  await expect(page.getByTestId("font-upload")).toHaveCount(0);
  const option = page.getByTestId("layer-font").getByTestId("font-option").filter({ hasText: fontName });
  await expect(option).toHaveCount(1);
  // Baseline on the fallback family; the built-in font must visibly change the text.
  await page.getByTestId("layer-font").selectOption("");
  const before = await stagePixels(page);
  await page.getByTestId("layer-font").selectOption({ label: (await option.textContent())! });
  await expect
    .poll(() => stagePixels(page))
    .not.toBe(before);
});
