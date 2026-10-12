import { apiTemplate, apiUpload, apiUser, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("templates: the create page loads more matches as the end of the list scrolls into view", async ({ page, request }) => {
  // Unique per project and per run, so the search matches exactly these templates.
  const prefix = scoped(`Scroll ${Date.now().toString(36)}`);
  const total = 30; // more than one page (24)
  const user = await apiUser(request, scoped("scroller"));
  const asset = await apiUpload(request, user, "still.png");
  for (let i = 0; i < total; i++) {
    await apiTemplate(request, user, { assetId: asset.id, name: `${prefix} ${String(i).padStart(2, "0")}` });
  }

  await page.goto("/create");
  await signIn(page, scoped("scroll-viewer"));
  await page.getByTestId("template-search").fill(prefix);
  // The search is debounced; wait until the grid shows it, or the unfiltered list could satisfy the count.
  const grid = page.getByTestId("template-grid");
  await expect(grid).toHaveAttribute("data-query", prefix);
  await expect(grid).toHaveAttribute("aria-busy", "false");
  const matches = page.getByTestId("template-card").filter({ hasText: prefix });
  await expect(matches.first()).toBeVisible();

  // Each time the sentinel scrolls into view a page loads: wait for more cards and an idle grid, until it is gone.
  const cards = page.getByTestId("template-card");
  const sentinel = page.getByTestId("load-more-sentinel");
  while ((await sentinel.count()) > 0) {
    const before = await cards.count();
    await sentinel.scrollIntoViewIfNeeded();
    await expect.poll(() => cards.count()).toBeGreaterThan(before);
    await expect(grid).toHaveAttribute("aria-busy", "false");
  }
  await expect(matches).toHaveCount(total);
  await expect(cards).toHaveCount(total);
  await expect(sentinel).toHaveCount(0);
  await expect(page.getByTestId("load-more")).toHaveCount(0);
});
