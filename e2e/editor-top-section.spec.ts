import type { Meme, TextLayer } from "@memegen/shared";
import { expect, scoped, test } from "./test.ts";
import { apiGet, download, editFixture, memeIdFromUrl, pngSize, stagePixels } from "./helpers.ts";

/** Stage canvas height / width (the width itself follows the aspect, so compare ratios). */
const stageAspect = (page: import("@playwright/test").Page) =>
  page.getByTestId("stage-canvas").evaluate((c) => (c as HTMLCanvasElement).height / (c as HTMLCanvasElement).width);

test("top section: the toggle adds a white band with its own text as layer 0; it saves, exports, and switches off", async ({ page, request }) => {
  const { user } = await editFixture(page, request, scoped("captioner"), "still.png"); // 640x480
  const items = page.getByTestId("layer-item");
  const toggle = page.getByTestId("top-section-toggle");
  await expect(items).toHaveCount(2);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await stageAspect(page)).toBeCloseTo(480 / 640, 2);

  // On: the band's text is layer 0 and the stage grows by the band (20% of the width by default, for one line).
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(items).toHaveCount(3);
  await expect(items.first()).toHaveAttribute("data-top-section", "true");
  await expect(items.first()).toHaveClass(/selected/);
  await expect.poll(() => stageAspect(page)).toBeCloseTo((480 + 128) / 640, 2);

  // Its settings size the band.
  let shown = await stagePixels(page);
  await items.first().getByTestId("layer-settings-toggle").click();
  await items.first().getByTestId("top-section-height").fill("30");
  await expect.poll(() => stageAspect(page)).toBeCloseTo((480 + 192) / 640, 2);
  await expect.poll(() => stagePixels(page)).not.toBe(shown);
  await items.first().getByTestId("layer-text").fill("when the build passes");
  await expect.poll(() => stageAspect(page)).toBeCloseTo((480 + 192) / 640, 2);

  // More lines grow the band by their height (same padding); the text never shrinks to fit it.
  await items.first().getByTestId("layer-text").fill("when the build passes on the first try ".repeat(5).trim());
  await expect.poll(() => stageAspect(page)).toBeGreaterThan((480 + 192) / 640 + 0.1);
  await items.first().getByTestId("layer-text").fill("when the build passes");
  await expect.poll(() => stageAspect(page)).toBeCloseTo((480 + 192) / 640, 2);

  await page.getByTestId("meme-title").fill("E2E top section");
  await page.getByTestId("save-draft").click();
  const id = await memeIdFromUrl(page);
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  const first = meme.layers[0] as TextLayer;
  expect([first.type, first.text, first.topSection?.height]).toEqual(["text", "when the build passes", 0.3]);

  // The export is taller by the band, and the band is white.
  const output = await download(request, meme.outputAsset);
  const size = pngSize(output);
  expect(size.height / size.width).toBeCloseTo((480 + 192) / 640, 2);
  const corner = await page.evaluate(async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return [...ctx.getImageData(2, 2, 1, 1).data];
  }, `/storage${meme.outputAsset.contentPath}`);
  expect(corner).toEqual([255, 255, 255, 255]);

  // Re-editing restores it; switching it off removes the band and its text.
  await page.goto(`/create?meme=${id}`);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  shown = await stagePixels(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(items).toHaveCount(2);
  await expect(page.locator('[data-top-section="true"]')).toHaveCount(0);
  await expect.poll(() => stageAspect(page)).toBeCloseTo(480 / 640, 2);
});
