import { readFileSync } from "node:fs";
import type { ImageLayer, Meme } from "@memegen/shared";
import { expect, scoped, test } from "./test.ts";
import { apiGet, editFixture, fixture, memeIdFromUrl, outputPixel, stagePixels } from "./helpers.ts";

test("image layers: upload one, paste another, resize, save; both draw on the export and reload with the meme", async ({ page, request }) => {
  const { user } = await editFixture(page, request, scoped("stickerfan"), "still.png");
  const items = page.getByTestId("layer-item");
  await expect(items).toHaveCount(2); // the template's top/bottom text

  // Add image: the file is checked and uploaded, then drawn centered and selected.
  let shown = await stagePixels(page);
  await page.getByTestId("add-image-file").setInputFiles(fixture("panel-a.jpg"));
  const uploaded = items.nth(2);
  await expect(uploaded).toHaveAttribute("data-layer-type", "image");
  await expect(uploaded).toHaveClass(/selected/);
  await expect.poll(() => stagePixels(page)).not.toBe(shown);

  // Its settings size it; the height follows the image.
  shown = await stagePixels(page);
  await uploaded.getByTestId("layer-settings-toggle").click();
  await uploaded.getByTestId("image-layer-width").fill("25");
  await expect.poll(() => stagePixels(page)).not.toBe(shown);

  // The selected image's corner handles scale it about the opposite corner, which stays put (dragging a corner twice
  // as far from it doubles the width), and the handle above it rotates it; the Layers panel shows both.
  const layerBox = page.getByTestId("layer-box").nth(2);
  const before = (await layerBox.boundingBox())!;
  const fixed = { x: before.x, y: before.y }; // nw, opposite the dragged se handle
  const corner = (await page.getByTestId("layer-scale-handle").and(page.locator('[data-corner="se"]')).boundingBox())!;
  const from = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(fixed.x + 2 * (from.x - fixed.x), fixed.y + 2 * (from.y - fixed.y), { steps: 5 });
  await page.mouse.up();
  await expect(uploaded.getByTestId("image-layer-width")).toHaveValue("50");
  const after = (await layerBox.boundingBox())!;
  expect(Math.abs(after.x - fixed.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - fixed.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.width - 2 * before.width)).toBeLessThanOrEqual(2);

  const mid = { x: after.x + after.width / 2, y: after.y + after.height / 2 };
  const knob = (await page.getByTestId("layer-rotate-handle").boundingBox())!;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(mid.x + 150, mid.y, { steps: 5 }); // from straight above the center to its right: +90°
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await uploaded.getByTestId("layer-angle").inputValue()) - 90)).toBeLessThanOrEqual(1);

  // Pasting an image anywhere in the editor adds another layer (clipboard paste, as from a screenshot).
  shown = await stagePixels(page);
  const bytes = [...readFileSync(fixture("panel-b.jpg"))];
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], "image.jpg", { type: "image/jpeg" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
  }, bytes);
  await expect(items).toHaveCount(4);
  await expect(items.nth(3)).toHaveAttribute("data-layer-type", "image");
  await expect.poll(() => stagePixels(page)).not.toBe(shown);

  // A GIF can't be an image layer: it is refused with the reason, and no layer is added.
  await page.getByTestId("add-image-file").setInputFiles(fixture("anim.gif"));
  await expect(page.getByTestId("image-layer-error")).toContainText("still images");
  await expect(items).toHaveCount(4);

  await page.getByTestId("meme-title").fill("E2E stickers");
  await page.getByTestId("save-draft").click();
  const id = await memeIdFromUrl(page);
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.layers.map((l) => l.type)).toEqual(["text", "text", "image", "image"]);
  const [first, second] = meme.layers.slice(2) as ImageLayer[];
  expect(first!.width).toBeCloseTo(0.5);
  expect(Math.abs(first!.angle - 90)).toBeLessThanOrEqual(1);
  expect(first!.assetId).not.toBe(second!.assetId);

  // The pasted image (solid blue, centered, on top) is in the exported file itself, not only the editor preview.
  const center = await outputPixel(page, meme.outputAsset, "center");
  expect(center[2]).toBeGreaterThan(200);
  expect(center[0]! + center[1]!).toBeLessThan(80);

  // Re-editing loads the image layers with the meme and draws them.
  await page.goto(`/create?meme=${id}`);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(items).toHaveCount(4);
  await expect(items.nth(2).getByTestId("layer-image")).toBeVisible();

  // A layer image that fails to load says so, and removing that layer clears the alert.
  await page.route(`**/assets/${first!.assetId}/content`, (route) => route.fulfill({ status: 500 }));
  await page.goto(`/create?meme=${id}`);
  await expect(page.getByTestId("image-load-error")).toBeVisible();
  await items.nth(2).getByTestId("layer-remove").click();
  await expect(items).toHaveCount(3);
  await expect(page.getByTestId("image-load-error")).toHaveCount(0);
});
