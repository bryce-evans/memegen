import { expect, scoped, test } from "./test.ts";
import type { Meme } from "@memegen/shared";
import { apiGet, download, dragLayer, editFixture, memeCard, memeIdFromUrl, openFeed, stagePixels, tagChip } from "./helpers.ts";

test("still image: edit and drag text on a template, tag, save draft, post, show in Recent", async ({ page, request }) => {
  const { user } = await editFixture(page, request, scoped("imgfan"), "still.png");
  await expect(page.getByTestId("timeline")).toHaveCount(0); // stills have no timeline

  // Stills edit each layer's text in place; the other settings open from the layer's edit button.
  const layer = page.getByTestId("layer-item").first();
  const before = await stagePixels(page);
  await layer.getByTestId("layer-text").fill("when the e2e passes");
  await expect.poll(() => stagePixels(page)).not.toBe(before);

  // The edit button stays usable while the text box has focus.
  await expect(layer.getByTestId("layer-settings")).toHaveCount(0);
  await layer.getByTestId("layer-settings-toggle").click();
  await layer.getByTestId("layer-style").selectOption("mock");
  await dragLayer(page, 0, 0, 120);

  await page.getByTestId("meme-title").fill("E2E still");
  await page.getByTestId("meme-tags").fill("Movie");
  await page.getByTestId("meme-tags").press("Enter");
  await page.getByTestId("save-draft").click();

  const id = await memeIdFromUrl(page);
  await expect(page.getByTestId("meme-status")).toContainText("draft");
  await expect(page.getByTestId("meme-title")).toHaveText("E2E still");

  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  // 640×480 template, exported upscaled to the 1200px minimum edge.
  expect(meme.outputAsset).toMatchObject({ kind: "image", width: 1200, height: 900 });
  expect(meme.layers[0]).toMatchObject({ text: "when the e2e passes", textStyle: "mock" });
  expect(meme.layers[0]!.y).toBeGreaterThan(0.15); // dragged down from the default top position
  expect(meme.tags).toEqual(["movie"]);
  const [source, output] = await Promise.all([download(request, meme.sourceAsset), download(request, meme.outputAsset)]);
  expect(output.equals(source)).toBe(false);

  // Drafts never reach the gallery; posting publishes. Tags show on the meme's page, not on gallery cards.
  await page.getByTestId("post-meme").click();
  await expect(page.getByTestId("meme-status")).toContainText("posted");
  await expect(tagChip(page, "movie")).toBeVisible();

  await openFeed(page, { feed: "recent" });
  const card = memeCard(page, id);
  await expect(card).toBeVisible();
  await expect(card.getByTestId("meme-age")).toHaveText(/now|ago/);
  await expect(card.getByTestId("tag-chip")).toHaveCount(0);
});
