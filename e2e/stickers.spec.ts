import type { ImageLayer, Meme, Page, Sticker } from "@memegen/shared";
import { expect, scoped, test } from "./test.ts";
import { apiGet, apiTemplate, apiUser, fixture, memeIdFromUrl, signIn, stagePixels } from "./helpers.ts";

test("stickers: + Sticker on Create takes PNGs up to 512x512; Add sticker puts one on a meme and its export", async ({ page, request }) => {
  const username = scoped("stickerbook");
  await page.goto("/create");
  await signIn(page, username);

  // Only PNGs up to 512x512: a bigger PNG and a JPEG are refused with the reason, before anything is stored.
  const file = page.getByTestId("new-sticker-file");
  const error = page.getByTestId("new-sticker-error");
  await file.setInputFiles(fixture("still.png"));
  await expect(error).toContainText("sticker is 640x480, max is 512x512");
  await file.setInputFiles(fixture("panel-a.jpg"));
  await expect(error).toContainText("stickers must be PNG");

  await file.setInputFiles(fixture("sticker.png"));
  const added = page.getByTestId("new-sticker-added");
  await expect(added).toContainText("Added sticker “sticker”");
  await expect(error).toBeHidden();
  const stickerId = (await added.getAttribute("data-sticker-id"))!;
  const stickers = await apiGet<Page<Sticker>>(request, "/api/stickers?limit=200");
  const sticker = stickers.items.find((s) => s.id === stickerId)!;
  expect([sticker.owner.username, sticker.asset.width, sticker.asset.height]).toEqual([username, 120, 80]);

  // In the editor, Add sticker opens the library; picking one adds it as a selected image layer.
  const user = await apiUser(request, username);
  const template = await apiTemplate(request, user, { name: `${username} base` });
  await page.goto(`/create?template=${template.id}`);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  const items = page.getByTestId("layer-item");
  await expect(items).toHaveCount(2);
  const shown = await stagePixels(page);

  await page.getByTestId("add-sticker").click();
  const picker = page.getByTestId("sticker-picker");
  await expect(picker.getByTestId("sticker-grid")).toHaveAttribute("aria-busy", "false");
  await picker.locator(`[data-testid="sticker-option"][data-sticker-id="${stickerId}"]`).click();
  await expect(picker).toBeHidden();
  await expect(items).toHaveCount(3);
  await expect(items.nth(2)).toHaveAttribute("data-layer-type", "image");
  await expect(items.nth(2)).toHaveClass(/selected/);
  await expect.poll(() => stagePixels(page)).not.toBe(shown);

  await page.getByTestId("meme-title").fill("E2E sticker");
  await page.getByTestId("save-draft").click();
  const id = await memeIdFromUrl(page);
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  const layer = meme.layers[2] as ImageLayer;
  expect([layer.type, layer.assetId, layer.name]).toEqual(["image", sticker.asset.id, "sticker"]);

  // The sticker (solid magenta, centered, on top) is in the exported file itself.
  const center = await page.evaluate(async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return [...ctx.getImageData(bitmap.width / 2, bitmap.height / 2, 1, 1).data];
  }, `/storage${meme.outputAsset.contentPath}`);
  expect(center[0]).toBeGreaterThan(200);
  expect(center[1]).toBeLessThan(60);
  expect(center[2]).toBeGreaterThan(200);
});
