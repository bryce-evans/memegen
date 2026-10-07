import { readFileSync } from "node:fs";
import type { Meme } from "@memegen/shared";
import { apiGet, apiUser, memeCard, memeIdFromUrl, openFeed, pngSize, signIn, stagePixels } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("create: pick a template, add top + bottom text, download, save to profile, post to gallery", async ({
  page,
  request,
}) => {
  const username = scoped("creator");
  await page.goto("/");
  await signIn(page, username);

  // Pick a template from the Create page's search.
  await page.getByTestId("nav-create").click();
  await page.getByTestId("template-search").fill("Mock Classic");
  const card = page.getByTestId("template-card").filter({ hasText: "Mock Classic" }).first();
  await card.getByTestId("use-template").click();
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");

  // The template's preset boxes: top and bottom.
  const layers = page.getByTestId("layer-item");
  await expect(layers).toHaveCount(2);
  const blank = await stagePixels(page);
  await layers.nth(0).getByTestId("layer-text").fill("when the mock data");
  await layers.nth(1).getByTestId("layer-text").fill("just works");
  await expect.poll(() => stagePixels(page)).not.toBe(blank);
  await page.getByTestId("meme-title").fill(`Workflow ${username}`);

  // Download the rendered meme without saving it.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-export").click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  // 600×450 template, exported upscaled to the 1200px minimum edge so the text stays sharp.
  expect(pngSize(readFileSync((await download.path())!))).toEqual({ width: 1200, height: 900 });

  // Save: a draft that shows on the author's profile but not in the gallery.
  await page.getByTestId("save-draft").click();
  const id = await memeIdFromUrl(page);
  await expect(page.getByTestId("meme-status")).toContainText("draft");
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, await apiUser(request, username));
  expect(meme.layers.map((l) => l.text)).toEqual(["when the mock data", "just works"]);
  expect(meme.templateId).not.toBeNull();

  await page.getByTestId("nav-profile").click();
  await expect(memeCard(page, id)).toBeVisible();

  // Post it and find it at the top of Recent.
  await page.goto(`/m/${id}`);
  await page.getByTestId("post-meme").click();
  await expect(page.getByTestId("meme-status")).toContainText("posted");
  await openFeed(page, { feed: "recent" });
  const posted = memeCard(page, id);
  await expect(posted).toBeVisible();
  await expect(posted).toContainText(`Workflow ${username}`);
});
