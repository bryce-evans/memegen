import { expect, scoped, test } from "./test.ts";
import type { Template } from "@memegen/shared";
import type { Page } from "@playwright/test";
import { apiGet, apiUser, signIn } from "./helpers.ts";

const source = { width: 95, height: 75 };
const first = { x: 5, y: 7, width: 24, height: 18 };
const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];

async function sheetFile(page: Page, direction: "horizontal" | "vertical", gap: number) {
  const data = await page.evaluate(({ source, first, direction, gap }) => {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, color] of ["#ff0000", "#00ff00", "#0000ff"].entries()) {
      const x = first.x + (direction === "horizontal" ? index * (first.width + gap) : 0);
      const y = first.y + (direction === "vertical" ? index * (first.height + gap) : 0);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, first.width, first.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, 2, 2);
      ctx.fillStyle = "#000000";
      ctx.fillRect(x + first.width - 2, y + first.height - 2, 2, 2);
    }
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, { source, first, direction, gap });
  return { name: `${direction}-sheet.png`, mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

async function drawFirstCrop(page: Page): Promise<void> {
  const canvas = page.getByTestId("sheet-crop-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await expect(canvas).toHaveAttribute("width", String(source.width));
  await expect(canvas).toHaveAttribute("height", String(source.height));
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("sheet crop canvas not visible");
  const point = (x: number, y: number) => ({
    x: box.x + x * box.width / source.width,
    y: box.y + y * box.height / source.height,
  });
  const start = point(first.x, first.y);
  const end = point(first.x + first.width, first.y + first.height);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("sheet-apply")).toBeEnabled();
  // Browser layout can round a scaled drag by a source pixel; keyboard fields give exact bounds.
  for (const [field, value] of Object.entries(first)) {
    await page.getByTestId(`sheet-crop-${field}`).fill(String(value));
  }
}

for (const direction of ["horizontal", "vertical"] as const) {
  test(`sheet crops: ${direction} source pixels become reusable editable native pack images`, async ({ page, request }) => {
    const username = scoped(`sheet-${direction}`);
    const gap = direction === "horizontal" ? 9 : 7;
    await page.goto("/create");
    await signIn(page, username);
    const user = await apiUser(request, username);
    await page.getByTestId("new-panel-template").click();
    const file = await sheetFile(page, direction, gap);
    const uploads: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/storage/assets") uploads.push(req.url());
    });

    await page.getByTestId("pack-sheet-file").setInputFiles(file);
    await drawFirstCrop(page);
    await page.getByTestId("sheet-cancel").click();
    await expect(page.getByTestId("sheet-crop-canvas")).toBeHidden();
    await expect(page.getByTestId("pack-item")).toHaveCount(0);
    await expect(page.getByTestId("panel-item")).toHaveCount(0);
    expect(uploads).toEqual([]);

    await page.getByTestId("pack-sheet-file").setInputFiles(file);
    await drawFirstCrop(page);
    await page.getByTestId("sheet-gap").fill("9");
    await page.getByTestId("sheet-direction-horizontal").click();
    await expect(page.getByTestId("sheet-crop-count")).toHaveText(/\b3\b/);
    await page.getByTestId("sheet-direction-vertical").click();
    await expect(page.getByTestId("sheet-crop-count")).toHaveText(/\b2\b/);
    await page.getByTestId(`sheet-direction-${direction}`).click();
    // At gap + 1 the last rectangle would cross the edge; partial crops must be excluded.
    await page.getByTestId("sheet-gap").fill(String(gap + 1));
    await expect(page.getByTestId("sheet-crop-count")).toHaveText(/\b2\b/);
    await page.getByTestId("sheet-gap").fill(String(gap));
    await expect(page.getByTestId("sheet-crop-count")).toHaveText(/\b3\b/);
    expect(uploads).toEqual([]);
    await page.getByTestId("sheet-apply").click();
    await expect(page.getByTestId("pack-item")).toHaveCount(3);
    await expect(page.getByTestId("panel-item")).toHaveCount(3);
    await expect(page.getByTestId("sheet-crop-canvas")).toBeHidden();
    await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
    expect(uploads).toHaveLength(3);

    const captions = ["first region", "second region", "third region"];
    for (const [index, caption] of captions.entries()) await page.getByTestId("panel-text").nth(index).fill(caption);
    await page.getByTestId("template-name").fill(`${username} native crops`);
    await page.getByTestId("template-save").click();
    await page.getByTestId("template-confirm").click();
    await page.waitForURL(/\/create\?template=/);
    const templateId = new URL(page.url()).searchParams.get("template")!;
    const template = await apiGet<Template>(request, `/api/templates/${templateId}`, user);
    expect(template.kind).toBe("multi");
    expect(template.defaultLayers).toEqual([]);
    const pack = template.panels!.pack;
    expect(pack).toHaveLength(3);
    for (const asset of pack) expect(asset).toMatchObject({ kind: "image", width: first.width, height: first.height });
    expect(template.panels!.defaultPanels.map((panel) => [panel.assetId, panel.text])).toEqual(
      pack.map((asset, index) => [asset.id, captions[index]]),
    );

    // Fetch the real persisted crop files, not previews or the rendered template cover.
    const decoded = await page.evaluate(async (paths) => {
      const results = [];
      for (const path of paths) {
        const response = await fetch(`/storage${path}`);
        if (!response.ok) throw new Error(`asset fetch failed: ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
        results.push({
          width: bitmap.width,
          height: bitmap.height,
          center: pixel(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2)),
          topLeft: pixel(0, 0),
          bottomRight: pixel(bitmap.width - 1, bitmap.height - 1),
        });
        bitmap.close();
      }
      return results;
    }, pack.map((asset) => asset.contentPath));
    expect(decoded).toEqual(colors.map((center) => ({
      width: first.width, height: first.height, center,
      topLeft: [255, 255, 255, 255], bottomRight: [0, 0, 0, 255],
    })));

    await page.goto(`/create?editTemplate=${templateId}`);
    await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("pack-item")).toHaveCount(3);
    for (const [index, caption] of captions.entries()) await expect(page.getByTestId("panel-text").nth(index)).toHaveValue(caption);
    for (const remove of await page.getByTestId("pack-item-remove").all()) await expect(remove).toBeDisabled();
    await page.getByTestId("panel-item").nth(0).getByTestId("panel-image").nth(2).click();
    await page.getByTestId("panel-text").nth(0).fill("reused third crop");
    await page.getByTestId("template-update").click();
    await expect(page.getByTestId("template-status")).toHaveAttribute("data-dirty", "false");
    const edited = await apiGet<Template>(request, `/api/templates/${templateId}`, user);
    expect(edited.panels!.pack.map((asset) => asset.id)).toEqual(pack.map((asset) => asset.id));
    expect(edited.panels!.defaultPanels.map((panel) => [panel.assetId, panel.text])).toEqual([
      [pack[2]!.id, "reused third crop"], [pack[1]!.id, captions[1]], [pack[2]!.id, captions[2]],
    ]);
  });
}
