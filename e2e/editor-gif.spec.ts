import { expect, test } from "@playwright/test";
import type { Meme } from "@memegen/shared";
import { apiGet, apiUser, download, dragLayer, fixture, memeIdFromUrl, probeStreams, signIn, stagePixels, uploadMedia } from "./helpers.ts";

test("gif: every frame on the timeline, keyframed animation, start window, GIF export keeps frames", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await signIn(page, "gifmaker");
  await page.getByTestId("nav-create").click();
  await uploadMedia(page, "anim.gif");
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");

  const timeline = page.getByTestId("timeline");
  await expect(timeline).toHaveAttribute("data-complete", "true");
  await expect(page.getByTestId("timeline-frame")).toHaveCount(12);
  await expect(page.getByTestId("current-frame")).toHaveText("1 / 12");

  // Stepping changes the displayed frame.
  const frame1 = await stagePixels(page);
  await page.getByTestId("next-frame").click();
  await expect(page.getByTestId("current-frame")).toHaveText("2 / 12");
  await expect.poll(() => stagePixels(page)).not.toBe(frame1);
  await page.getByTestId("prev-frame").click();
  await expect(page.getByTestId("current-frame")).toHaveText("1 / 12");

  // Keyframe at frame 1, then move the text at the last frame (creates a second keyframe).
  await page.getByTestId("layer-item").first().click();
  await page.getByTestId("layer-text").fill("slide");
  await page.getByTestId("add-keyframe").click();
  await expect(page.getByTestId("keyframe-item")).toHaveCount(1);
  await page.locator('[data-testid="timeline-frame"][data-index="11"]').click();
  await expect(page.getByTestId("current-frame")).toHaveText("12 / 12");
  await dragLayer(page, 0, 0, 40);
  await expect(page.getByTestId("keyframe-item")).toHaveCount(2);

  // Text only from frame 3 on.
  await page.locator('[data-testid="timeline-frame"][data-index="2"]').click();
  await page.getByTestId("set-start").click();

  await page.getByTestId("meme-title").fill("E2E gif");
  await page.getByTestId("post-meme").click();
  await expect(page.getByTestId("export-progress")).toBeVisible();
  const id = await memeIdFromUrl(page);
  await expect(page.getByTestId("meme-media")).toHaveJSProperty("tagName", "IMG");

  const user = await apiUser(request, "gifmaker");
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.outputAsset).toMatchObject({ kind: "gif", width: 160, height: 120, frameCount: 12 });
  const slide = meme.layers[0]!;
  expect(slide.keyframes).toHaveLength(2);
  expect(slide.keyframes[0]!.t).toBe(0);
  expect(slide.keyframes[1]!.t).toBeCloseTo(1.1, 2);
  expect(slide.keyframes[1]!.y).toBeGreaterThan(slide.keyframes[0]!.y);
  expect(slide.start).toBeCloseTo(0.2, 2);
  expect(probeStreams(await download(request, meme.outputAsset), ".gif")).toEqual({ video: 12 });
});
