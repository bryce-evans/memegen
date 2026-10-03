import { expect, scoped, test } from "./test.ts";
import { readFileSync } from "node:fs";
import { fixture, signIn, stagePixels, uploadMedia } from "./helpers.ts";

test("upload caps are enforced before upload, with the reason shown", async ({ page }) => {
  await page.goto("/");
  await signIn(page, scoped("rulebreaker"));
  await page.getByTestId("nav-create").click();
  await uploadMedia(page, "too-wide.gif");
  await expect(page.getByTestId("editor-error")).toContainText("1100x60");
  await expect(page.getByTestId("editor-error")).toContainText("1024");
  await expect(page.getByTestId("stage-canvas")).toHaveCount(0);
});

test("custom font upload becomes selectable and changes the render", async ({ page }) => {
  await page.goto("/");
  await signIn(page, scoped("typographer"));
  await page.getByTestId("nav-create").click();
  await uploadMedia(page, "still.png");
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("layer-item").first().click();

  await page.getByTestId("font-upload").setInputFiles({
    name: `${scoped("My Font")}.ttf`,
    mimeType: "font/ttf",
    buffer: readFileSync(fixture("TitilliumWeb-Black.ttf")),
  });
  const option = page.getByTestId("layer-font").locator("option", { hasText: scoped("My Font") });
  await expect(option).toHaveCount(1);
  // Baseline on the fallback family; the uploaded font must visibly change the text.
  await page.getByTestId("layer-font").selectOption("");
  const before = await stagePixels(page);
  await page.getByTestId("layer-font").selectOption({ label: (await option.textContent())! });
  await expect
    .poll(() => stagePixels(page))
    .not.toBe(before);
});
