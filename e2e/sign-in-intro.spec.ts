import { signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("sign-in intro: every meme sprite loads, the burst plays through, and the login stays usable over it", async ({
  page,
}) => {
  await page.goto("/");
  const intro = page.getByTestId("intro-burst");
  await expect(intro).toHaveAttribute("data-ready", "true");
  await expect(intro).toHaveAttribute("data-done", "true");

  const widths = await intro.locator("img").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth));
  expect(widths).toHaveLength(7);
  for (const width of widths) expect(width).toBeGreaterThan(0);

  const username = scoped("intro-viewer");
  await signIn(page, username);
  await expect(page.getByTestId("intro-burst")).toHaveCount(0);
});
