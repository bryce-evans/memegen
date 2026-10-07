import { expect, scoped, test } from "./test.ts";
import type { Meme, Template } from "@memegen/shared";
import type { Page } from "@playwright/test";
import { apiGet, apiUser, fixture, memeIdFromUrl, signIn, stagePixels } from "./helpers.ts";

async function expectPanelTexts(page: Page, texts: string[]): Promise<void> {
  await expect(page.getByTestId("panel-text")).toHaveCount(texts.length);
  for (const [i, text] of texts.entries()) await expect(page.getByTestId("panel-text").nth(i)).toHaveValue(text);
}

test("multi-panel: build a template from an image pack, make a meme with more panels, re-edit it", async ({ page, request }) => {
  const username = scoped("brainfan");
  await page.goto("/create");
  await signIn(page, username);
  const user = await apiUser(request, username);

  // New multi-panel template: uploading the pack starts one panel per image.
  await page.getByTestId("new-panel-template").click();
  await expect(page.getByTestId("editor-title")).toHaveText("Multi-panel Template Editor");
  await expect(page.getByTestId("panel-empty")).toBeVisible();
  await expect(page.getByTestId("template-save")).toBeDisabled();
  await page.getByTestId("pack-file").setInputFiles([fixture("panel-a.jpg"), fixture("panel-b.jpg")]);
  await expect(page.getByTestId("pack-item")).toHaveCount(2);
  await expect(page.getByTestId("panel-item")).toHaveCount(2);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");

  const before = await stagePixels(page);
  await page.getByTestId("panel-text").nth(0).fill("small brain");
  await expect.poll(() => stagePixels(page)).not.toBe(before);
  await page.getByTestId("panel-text").nth(1).fill("big brain");
  const name = `${username} brains`;
  await page.getByTestId("template-name").fill(name);
  await page.getByTestId("template-save").click();
  await page.getByTestId("template-confirm").click();
  await page.waitForURL(/\/create\?template=/);
  const templateId = new URL(page.url()).searchParams.get("template")!;

  const template = await apiGet<Template>(request, `/api/templates/${templateId}`, user);
  expect(template.defaultLayers).toEqual([]);
  expect(template.panels?.layout).toBe("vertical");
  expect(template.panels?.pack.map((a) => a.filename)).toEqual(["panel-a.jpg", "panel-b.jpg"]);
  const [packA, packB] = template.panels!.pack.map((a) => a.id);
  expect(template.panels?.defaultPanels.map((p) => [p.assetId, p.text])).toEqual([
    [packA, "small brain"],
    [packB, "big brain"],
  ]);
  // The cover is the default panels rendered: two rows (400×400 then 400×300, drawn whole) of caption | image.
  expect(template.asset).toMatchObject({ kind: "image", width: 1200, height: 1050 });

  // Using it: the defaults load; a new panel continues through the pack, and its image reference can change.
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expectPanelTexts(page, ["small brain", "big brain"]);
  await page.getByTestId("add-panel").click();
  const third = page.getByTestId("panel-item").nth(2);
  await expect(third.getByTestId("panel-image").nth(0)).toHaveAttribute("aria-pressed", "true");
  await third.getByTestId("panel-image").nth(1).click();
  await expect(third.getByTestId("panel-image").nth(1)).toHaveAttribute("aria-pressed", "true");
  await third.getByTestId("panel-text").fill("galaxy brain");
  await page.getByTestId("layout-horizontal").click();
  // Hiding the grid and shrinking the captions both redraw the stage and are saved with the meme.
  let shown = await stagePixels(page);
  await page.getByTestId("grid-hide").click();
  await expect.poll(() => stagePixels(page)).not.toBe(shown);
  shown = await stagePixels(page);
  await page.getByTestId("panel-font-size").fill("5");
  await expect.poll(() => stagePixels(page)).not.toBe(shown);
  await page.getByTestId("meme-title").fill("E2E brains");
  await page.getByTestId("save-draft").click();

  const id = await memeIdFromUrl(page);
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.layers).toEqual([]);
  expect(meme.panels).toMatchObject({ layout: "horizontal", grid: false, fontSize: 0.05 });
  expect(meme.panels?.panels.map((p) => [p.assetId, p.text])).toEqual([
    [packA, "small brain"],
    [packB, "big brain"],
    [packB, "galaxy brain"],
  ]);
  // Columns as wide as their images at one height (1 + 4/3 + 4/3 units) under a half-unit caption strip, 600 px/unit.
  expect(meme.outputAsset).toMatchObject({ kind: "image", mime: "image/jpeg", width: 2200, height: 900 });

  // Re-editing opens the panel editor with the meme's own panels and layout.
  await page.goto(`/create?meme=${id}`);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expectPanelTexts(page, ["small brain", "big brain", "galaxy brain"]);
  await expect(page.getByTestId("layout-horizontal")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("grid-hide")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("panel-font-size")).toHaveValue("5");
  await expect(page.getByTestId("pack-file")).toHaveCount(0); // the pack is only edited by template authors

  // The author edits the template: saved pack images stay, the layout and defaults change, and the cover follows.
  await page.goto(`/create?editTemplate=${templateId}`);
  await expect(page.getByTestId("editor-title")).toHaveText("Edit template");
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("pack-item").getByRole("button")).toHaveCount(2);
  for (const remove of await page.getByTestId("pack-item").getByRole("button").all()) await expect(remove).toBeDisabled();
  await page.getByTestId("remove-panel").nth(1).click();
  await page.getByTestId("layout-horizontal").click();
  await page.getByTestId("template-update").click();
  await expect(page.getByTestId("template-status")).toHaveAttribute("data-dirty", "false");
  const edited = await apiGet<Template>(request, `/api/templates/${templateId}`, user);
  expect(edited.panels?.layout).toBe("horizontal");
  expect(edited.panels?.pack.map((a) => a.id)).toEqual([packA, packB]);
  expect(edited.panels?.defaultPanels.map((p) => p.text)).toEqual(["small brain"]);
  expect(edited.asset).toMatchObject({ kind: "image", width: 600, height: 900 });
});
