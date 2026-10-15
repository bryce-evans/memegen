import { signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("sign-in intro: every meme sprite loads, the burst plays through, and the login stays usable over it", async ({
  page,
}) => {
  await page.goto("/");
  const intro = page.getByTestId("intro-burst");
  await expect(intro).toHaveAttribute("data-ready", "true");
  await expect(intro).toHaveAttribute("data-done", "true");

  const widths = await intro.getByTestId("intro-image").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth));
  expect(widths).toHaveLength(9);
  for (const width of widths) expect(width).toBeGreaterThan(0);

  const username = scoped("intro-viewer");
  await signIn(page, username);
  await expect(page.getByTestId("intro-burst")).toHaveCount(0);
});

test("sign-in intro: nyan cat stays on screen; a smaller window shows less rainbow, never less cat", async ({ page }) => {
  const nyan = page.getByTestId("intro-nyan");
  // The rotated strip's bounds, and how much of the image (a 242 × 1689 strip) it shows.
  const measure = () =>
    nyan.evaluate((el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top, shown: el.offsetHeight / (el.offsetWidth * (1689 / 242)) };
    });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByTestId("intro-burst")).toHaveAttribute("data-done", "true");
  const roomy = await measure();
  expect(roomy.shown).toBeCloseTo(1); // the whole rainbow fits
  expect(Math.min(roomy.left, roomy.top)).toBeGreaterThanOrEqual(0);

  // Room for the cat but not the whole rainbow (narrower still and the card leaves no room even for the cat).
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(async () => (await measure()).shown).toBeLessThan(roomy.shown);
  const cramped = await measure();
  expect(Math.min(cramped.left, cramped.top)).toBeGreaterThanOrEqual(0);
});
