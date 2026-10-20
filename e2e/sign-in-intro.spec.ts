import type { Page } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

/** Picks `kind` in the sign-in page's dev tools; the intro restarts as that kind. */
async function pickIntro(page: Page, kind: string): Promise<void> {
  await page.getByTestId("dev-intro").selectOption(kind);
  await expect(page.getByTestId("intro")).toHaveAttribute("data-intro", kind);
}

test("sign-in intro: the config's default is basic, the card alone; dev tools preview the others and the choice outlasts reloads", async ({
  page,
}) => {
  await page.goto("/");
  const intro = page.getByTestId("intro");
  await expect(intro).toHaveAttribute("data-intro", "basic");
  await expect(intro).toHaveAttribute("data-done", "true");
  await expect(intro.getByTestId("intro-image")).toHaveCount(0);

  await pickIntro(page, "nyan");
  await page.reload();
  await expect(intro).toHaveAttribute("data-intro", "nyan");
  await pickIntro(page, "basic");
  await page.reload();
  await expect(intro).toHaveAttribute("data-intro", "basic");
});

test("sign-in intro (party): every meme sprite, confetti piece, and streamer loads, the burst plays through, and the login stays usable over it", async ({
  page,
}) => {
  await page.goto("/");
  await pickIntro(page, "party");
  const intro = page.getByTestId("intro");
  await expect(intro).toHaveAttribute("data-ready", "true");
  await expect(intro).toHaveAttribute("data-done", "true");

  const widths = await intro.getByTestId("intro-image").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth));
  expect(widths).toHaveLength(14);
  for (const width of widths) expect(width).toBeGreaterThan(0);

  const particles = await intro.getByTestId("intro-particle").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth));
  expect(particles.length).toBeGreaterThan(100);
  for (const width of particles) expect(width).toBeGreaterThan(0);

  const username = scoped("intro-viewer");
  await signIn(page, username);
  await expect(page.getByTestId("intro")).toHaveCount(0);
});

test("sign-in intro (party): nyan cat stays on screen; a smaller window shows less rainbow, never less cat", async ({ page }) => {
  const nyan = page.getByTestId("intro-nyan");
  // The rotated strip's bounds, and how much of the longest flight (the cat and a 1689 / 242 strip of rainbow) it shows.
  const measure = () =>
    nyan.evaluate((el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top, shown: el.offsetHeight / (el.offsetWidth * (1689 / 242)) };
    });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await pickIntro(page, "party");
  await expect(page.getByTestId("intro")).toHaveAttribute("data-done", "true");
  const roomy = await measure();
  expect(roomy.shown).toBeCloseTo(1); // the whole rainbow fits
  expect(Math.min(roomy.left, roomy.top)).toBeGreaterThanOrEqual(0);

  // Room for the cat but not the whole rainbow (narrower still and the card leaves no room even for the cat).
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(async () => (await measure()).shown).toBeLessThan(roomy.shown);
  const cramped = await measure();
  expect(Math.min(cramped.left, cramped.top)).toBeGreaterThanOrEqual(0);
});

test("sign-in intro (nyan): nyan cat flies in a straight line from off the bottom or right edge, behind the card, and out of its top-left corner", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await pickIntro(page, "nyan");
  await expect(page.getByTestId("intro")).toHaveAttribute("data-done", "true");

  const card = (await page.getByTestId("sign-in-card").boundingBox())!;
  const flyby = page.getByTestId("intro-nyan-flyby");
  // The rainbow comes in from off the screen's bottom or right edge.
  const strip = (await flyby.boundingBox())!;
  expect(strip.x + strip.width >= 1400 || strip.y + strip.height >= 900).toBe(true);

  // The cat ends above and left of the card, on screen.
  const cat = (await flyby.getByTestId("intro-image").boundingBox())!;
  expect(cat.x + cat.width).toBeLessThan(card.x);
  expect(cat.y + cat.height).toBeLessThan(card.y);
  expect(Math.min(cat.x, cat.y)).toBeGreaterThanOrEqual(0);

  // One straight line at 20° above horizontal, through the card's top-left corner to the cat.
  const to = { x: cat.x + cat.width / 2 - card.x, y: cat.y + cat.height / 2 - card.y };
  const angle = (Math.atan2(-to.y, -to.x) * 180) / Math.PI;
  expect(angle).toBeGreaterThan(18);
  expect(angle).toBeLessThan(22);

  // The login works over it.
  await signIn(page, scoped("nyan-viewer"));
  await expect(page.getByTestId("intro")).toHaveCount(0);
});
