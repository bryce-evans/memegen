import { expect, test } from "@playwright/test";
import type { Meme } from "@memegen/shared";
import { apiGet, apiUser, download, fixture, memeIdFromUrl, probeStreams, signIn, uploadMedia } from "./helpers.ts";

test("video: frame-accurate timeline, MP4 export keeps every frame and the audio track", async ({ page, request }) => {
  await page.goto("/");
  await signIn(page, "director");
  await page.getByTestId("nav-create").click();
  await uploadMedia(page, "clip.mp4");
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-complete", "true");
  await expect(page.getByTestId("timeline-frame")).toHaveCount(30);

  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("current-frame")).not.toHaveText("1 / 30");
  await page.getByTestId("play-toggle").click();

  await page.getByTestId("layer-item").first().click();
  await page.getByTestId("layer-text").fill("rolling");
  await page.locator('[data-testid="timeline-frame"][data-index="15"]').click();
  await page.getByTestId("set-end").click();

  await page.getByTestId("meme-title").fill("E2E video");
  await page.getByTestId("post-meme").click();
  const id = await memeIdFromUrl(page);
  await expect(page.getByTestId("meme-media")).toHaveJSProperty("tagName", "VIDEO");

  const user = await apiUser(request, "director");
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.outputAsset).toMatchObject({ kind: "video", mime: "video/mp4", width: 320, height: 240, frameCount: 30 });
  expect(meme.layers[0]!.end).toBeCloseTo(0.5, 2);
  const streams = probeStreams(await download(request, meme.outputAsset), ".mp4");
  expect(streams.video).toBe(30);
  expect(streams.audio).toBeGreaterThan(0);
});
