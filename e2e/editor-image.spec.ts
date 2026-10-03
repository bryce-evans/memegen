import { expect, scoped, test } from "./test.ts";
import type { Meme } from "@memegen/shared";
import { apiGet, apiUser, download, dragLayer, memeIdFromUrl, setFilters, signIn, stagePixels, uploadMedia } from "./helpers.ts";

test("still image: upload, edit and drag text, tag, save draft, post, show in gallery", async ({ page, request }) => {
  await page.goto("/");
  await signIn(page, scoped("imgfan"));
  await page.getByTestId("nav-create").click();

  await uploadMedia(page, "still.png");
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("timeline")).toHaveCount(0); // stills have no timeline

  const layer = page.getByTestId("layer-item").first();
  await layer.click();
  const before = await stagePixels(page);
  await page.getByTestId("layer-text").fill("when the e2e passes");
  await expect.poll(() => stagePixels(page)).not.toBe(before);

  await page.getByTestId("layer-style").selectOption("mock");
  await dragLayer(page, 0, 0, 120);

  await page.getByTestId("meme-title").fill("E2E still");
  await page.getByTestId("meme-tags").fill("Movie");
  await page.getByTestId("meme-tags").press("Enter");
  await page.getByTestId("save-draft").click();

  const id = await memeIdFromUrl(page);
  await expect(page.getByTestId("meme-status")).toContainText("draft");
  await expect(page.getByTestId("meme-title")).toHaveText("E2E still");

  const user = await apiUser(request, scoped("imgfan"));
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.outputAsset).toMatchObject({ kind: "image", width: 640, height: 480 });
  expect(meme.layers[0]).toMatchObject({ text: "when the e2e passes", textStyle: "mock" });
  expect(meme.layers[0]!.y).toBeGreaterThan(0.15); // dragged down from the default top position
  expect(meme.tags).toEqual(["movie"]);
  const [source, output] = await Promise.all([download(request, meme.sourceAsset), download(request, meme.outputAsset)]);
  expect(output.equals(source)).toBe(false);

  // Drafts never reach the gallery; posting publishes.
  await page.getByTestId("post-meme").click();
  await expect(page.getByTestId("meme-status")).toContainText("posted");

  await page.getByTestId("nav-gallery").click();
  await setFilters(page, { period: "day", sort: "new" });
  const card = page.locator(`[data-testid="meme-card"][data-meme-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId("tag-chip")).toHaveAttribute("data-tag", "movie");
  await expect(card.getByTestId("meme-age")).toHaveText(/now|ago/);
});
