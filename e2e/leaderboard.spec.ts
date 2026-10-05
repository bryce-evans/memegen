import type { Locator } from "@playwright/test";
import { MOCK_EXPECT } from "../scripts/mock/data.ts";
import { signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

const numbers = (cells: Locator) => cells.evaluateAll((els) => els.map((el) => Number(el.textContent)));
const descending = (values: number[]) => values.length > 0 && values.every((v, i) => i === 0 || values[i - 1]! >= v);

test("leaderboard: ranks users by the chosen stat and links to profiles", async ({ page }) => {
  await page.goto("/");
  await signIn(page, scoped("ranker"));
  await page.getByTestId("nav-leaderboard").click();
  await expect(page).toHaveURL(/\/leaderboard$/);
  await page.getByTestId("leaderboard-by-hScore").click();
  await expect(page.getByTestId("leaderboard-by-hScore")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("leaderboard")).toHaveAttribute("aria-busy", "false");

  const alice = page.locator('[data-testid="leaderboard-row"][data-username="mock-alice"]');
  await expect(alice.getByTestId("lb-meme-count")).toHaveText(String(MOCK_EXPECT.aliceStats.memeCount));
  await expect(alice.getByTestId("lb-high-score")).toHaveText(String(MOCK_EXPECT.aliceStats.highScore));
  await expect(alice.getByTestId("lb-h-score")).toHaveText(String(MOCK_EXPECT.aliceStats.hScore));

  // Ranks count up from 1 and the chosen stat never increases down the list.
  const rows = page.getByTestId("leaderboard-row");
  const ranks = await numbers(rows.getByTestId("leaderboard-rank"));
  expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  expect(descending(await numbers(rows.getByTestId("lb-h-score")))).toBe(true);

  await page.getByTestId("leaderboard-by-memeCount").click();
  await expect(page).toHaveURL(/\?by=memeCount$/);
  await expect.poll(async () => descending(await numbers(rows.getByTestId("lb-meme-count")))).toBe(true);
  await expect(alice.getByTestId("lb-meme-count")).toHaveText(String(MOCK_EXPECT.aliceStats.memeCount));

  await alice.getByRole("link", { name: "@mock-alice" }).click();
  await expect(page).toHaveURL(/\/u\/mock-alice$/);
});
