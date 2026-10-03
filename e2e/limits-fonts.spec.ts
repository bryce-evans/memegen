import { expect, scoped, test } from "./test.ts";
import { readFileSync } from "node:fs";
import { editFixture, fixture, signIn, stagePixels } from "./helpers.ts";

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

test("custom font upload becomes selectable and changes the render", async ({ page, request }) => {
  const fontName = scoped("My Font");
  await editFixture(page, request, scoped("typographer"), "still.png");
  await page.getByTestId("layer-item").first().click();

  await page.getByTestId("font-upload").setInputFiles({
    name: `${fontName}.ttf`,
    mimeType: "font/ttf",
    buffer: readFileSync(fixture("TitilliumWeb-Black.ttf")),
  });
  const option = page.getByTestId("layer-font").locator("option", { hasText: fontName });
  await expect(option).toHaveCount(1);
  // Baseline on the fallback family; the uploaded font must visibly change the text.
  await page.getByTestId("layer-font").selectOption("");
  const before = await stagePixels(page);
  await page.getByTestId("layer-font").selectOption({ label: (await option.textContent())! });
  await expect
    .poll(() => stagePixels(page))
    .not.toBe(before);
});
