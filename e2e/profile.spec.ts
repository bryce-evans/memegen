import { MOCK_EXPECT } from "../scripts/mock/data.ts";
import { loadAll, mockTitles, setFilters } from "./helpers.ts";
import { expect, test } from "./test.ts";

test("profile: open an author from the gallery and see their stats and public memes", async ({ page }) => {
  await page.goto("/");
  await setFilters(page, { period: "week", sort: "best" });
  const card = page.getByTestId("meme-card").filter({ hasText: "Mock: Top of the Week" });
  await card.getByRole("link", { name: "mock-alice" }).click();
  await expect(page).toHaveURL(/\/u\/mock-alice$/);

  await expect(page.getByTestId("stat-meme-count")).toHaveText(String(MOCK_EXPECT.aliceStats.memeCount));
  await expect(page.getByTestId("stat-high-score")).toHaveText(String(MOCK_EXPECT.aliceStats.highScore));
  await expect(page.getByTestId("stat-h-score")).toHaveText(String(MOCK_EXPECT.aliceStats.hScore));

  await loadAll(page);
  const titles = await mockTitles(page);
  expect([...titles].sort()).toEqual([...MOCK_EXPECT.alicePublicTitles].sort());
});
