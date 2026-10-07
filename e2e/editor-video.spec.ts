import { expect, scoped, test } from "./test.ts";
import type { Meme } from "@memegen/shared";
import { apiGet, download, editFixture, memeIdFromUrl, probeStreams, timelineFrame } from "./helpers.ts";

test("video: frame-accurate timeline, MP4 export keeps every frame and the audio track", async ({ page, request }) => {
  const { user } = await editFixture(page, request, scoped("director"), "clip.mp4");
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-complete", "true");
  await expect(page.getByTestId("timeline-frame")).toHaveCount(30);

  await page.getByTestId("play-toggle").click();
  await expect(page.getByTestId("current-frame")).not.toHaveText("1 / 30");
  await page.getByTestId("play-toggle").click();

  // Focusing a layer's text shows its window as "Frame [1] to [30]" right under it, without opening its settings.
  // Typing a frame number moves that edge and shows the frame: through frame 16 is end = 0.50s.
  const layer = page.getByTestId("layer-item").first();
  await layer.getByTestId("layer-text").fill("rolling");
  await expect(layer.getByTestId("window-start")).toHaveValue("1");
  await expect(layer.getByTestId("window-end")).toHaveValue("30");
  await layer.getByTestId("window-end").fill("16");
  await expect(page.getByTestId("current-frame")).toHaveText("16 / 30");

  // Each layer has a track under the frames, on the same cells. Dragging its end handle onto frame 12's right edge
  // keeps the text through frame 12 (0.37s), and the bar's ends sit exactly on the edges of the frames it covers.
  const track = page.getByTestId("layer-track").first();
  const end = (await track.getByTestId("track-end").boundingBox())!;
  const frame12 = (await timelineFrame(page, 11).boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame12.x + frame12.width - 1, end.y + end.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(layer.getByTestId("window-end")).toHaveValue("12");
  await expect(page.getByTestId("current-frame")).toHaveText("12 / 30");
  const bar = (await track.getByTestId("track-span").boundingBox())!;
  const first = (await timelineFrame(page, 0).boundingBox())!;
  const last = (await timelineFrame(page, 11).boundingBox())!;
  expect(Math.abs(bar.x - first.x)).toBeLessThan(1);
  expect(Math.abs(bar.x + bar.width - (last.x + last.width))).toBeLessThan(1);

  await page.getByTestId("meme-title").fill("E2E video");
  await page.getByTestId("post-meme").click();
  const id = await memeIdFromUrl(page);
  await expect(page.getByTestId("meme-media")).toHaveJSProperty("tagName", "VIDEO");

  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.outputAsset).toMatchObject({ kind: "video", mime: "video/mp4", width: 320, height: 240, frameCount: 30 });
  expect(meme.layers[0]!.start).toBeNull();
  expect(meme.layers[0]!.end).toBeCloseTo(11 / 30, 2);
  const streams = probeStreams(await download(request, meme.outputAsset), ".mp4");
  expect(streams.video).toBe(30);
  expect(streams.audio).toBeGreaterThan(0);
});
