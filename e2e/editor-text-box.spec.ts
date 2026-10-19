import type { Meme, TextLayer } from "@memegen/shared";
import { expect, scoped, test } from "./test.ts";
import { apiGet, editFixture, memeIdFromUrl } from "./helpers.ts";

test("text boxes: raising the max size grows the box to show it; corner handles resize the box", async ({ page, request }) => {
  const { user } = await editFixture(page, request, scoped("boxer"), "still.png");
  const layer = page.getByTestId("layer-item").first();
  const textBox = page.getByTestId("layer-box").first();
  await layer.getByTestId("layer-settings-toggle").click();
  const height = layer.getByTestId("text-box-height");
  const width = layer.getByTestId("text-box-width");
  await expect(height).toHaveValue("20");

  // Text shrinks to fit its box, so a larger max size would change nothing unless the box grows with it.
  const small = (await textBox.boundingBox())!;
  await layer.getByTestId("layer-font-size").fill("20");
  await expect.poll(async () => Number(await height.inputValue())).toBeGreaterThan(20);
  await expect.poll(async () => (await textBox.boundingBox())!.height).toBeGreaterThan(small.height * 1.5);

  // The selected text layer shows its box with corner handles; dragging one resizes the box about the opposite corner.
  await textBox.click();
  const frame = page.getByTestId("text-box-frame");
  await expect(frame).toBeVisible();
  const before = (await frame.boundingBox())!;
  const handle = (await frame.getByTestId("text-box-handle").and(page.locator('[data-corner="se"]')).boundingBox())!;
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - before.width / 2, from.y + 40, { steps: 5 });
  await page.mouse.up();
  const after = (await frame.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(after.width - before.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.height - (before.height + 40))).toBeLessThanOrEqual(2);
  expect(Math.abs(Number(await width.inputValue()) - 48)).toBeLessThanOrEqual(1); // about half of 96%
  const boxHeight = Number(await height.inputValue()) / 100;

  await page.getByTestId("meme-title").fill("E2E text box");
  await page.getByTestId("save-draft").click();
  const id = await memeIdFromUrl(page);
  const saved = (await apiGet<Meme>(request, `/api/memes/${id}`, user)).layers[0] as TextLayer;
  expect(saved.fontSize).toBe(0.2);
  expect(saved.maxWidth).toBeCloseTo(0.48, 1);
  expect(saved.maxHeight).toBeCloseTo(boxHeight, 1);
});

test("text boxes: the selected box's handle rotates it; ⌘⌫ removes the box rather than clearing its text", async ({ page, request }) => {
  await editFixture(page, request, scoped("boxturner"), "still.png");
  const items = page.getByTestId("layer-item");
  const count = await items.count();
  const layer = items.first();
  const layerId = (await layer.getAttribute("data-layer-id"))!;
  const textBox = page.getByTestId("layer-box").first();
  await layer.getByTestId("layer-settings-toggle").click();

  await textBox.click();
  const box = (await textBox.boundingBox())!;
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const knob = (await page.getByTestId("text-box-rotate-handle").boundingBox())!;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(mid.x + 150, mid.y, { steps: 5 }); // from straight above the center to its right: +90°
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await layer.getByTestId("layer-angle").inputValue()) - 90)).toBeLessThanOrEqual(1);

  // Pressing the box focuses its text; ⌘⌫ there removes the whole layer.
  await textBox.click();
  await expect(layer.getByTestId("layer-text")).toBeFocused();
  await page.keyboard.press("Meta+Backspace");
  await expect(items).toHaveCount(count - 1);
  await expect(page.locator(`[data-testid="layer-item"][data-layer-id="${layerId}"]`)).toHaveCount(0);
});

test("preview: the box beside the template's title hides every box and handle, and unchecking brings them back", async ({ page, request }) => {
  await editFixture(page, request, scoped("previewer"), "still.png");
  const stage = page.getByTestId("stage");
  const boxes = page.getByTestId("layer-box");
  const count = await boxes.count();
  await boxes.first().click();
  await expect(page.getByTestId("text-box-frame")).toBeVisible();

  const preview = page.getByTestId("template-details").getByTestId("stage-preview");
  await preview.check();
  await expect(stage).toHaveAttribute("data-preview", "true");
  await expect(boxes).toHaveCount(0);
  await expect(page.getByTestId("text-box-frame")).toHaveCount(0);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");

  // Unchecked, editing picks up where it left off: the same boxes, the selected one still framed.
  await preview.uncheck();
  await expect(stage).not.toHaveAttribute("data-preview");
  await expect(boxes).toHaveCount(count);
  await expect(page.getByTestId("text-box-frame")).toBeVisible();
});
