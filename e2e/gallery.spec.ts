import type { Meme, Page as Paged } from "@memegen/shared";
import { MOCK_EXPECT } from "./mock/data.ts";
import { apiGet, expectInOrder, loadAll, mockTitles, openFeed, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("gallery: popular all time and this month, recent newest first; hidden memes stay hidden", async ({ page }) => {
  await page.goto("/recent");
  await signIn(page, scoped("browser"));

  // Popular (best) opens on all time.
  await openFeed(page, { feed: "popular" });
  await expect(page.getByTestId("meme-feed")).toHaveAttribute("data-period", "all");
  await expect.poll(async () => (await mockTitles(page))[0]).toBe(MOCK_EXPECT.bestAllTime[0]);
  await loadAll(page);
  const popular = await mockTitles(page);
  expectInOrder(popular, MOCK_EXPECT.bestAllTime);
  for (const hidden of MOCK_EXPECT.hidden) expect(popular).not.toContain(hidden);

  // Recent: newest first, all time. Other specs post newer (non-mock) memes, so the mock ones may sit past page one.
  await openFeed(page, { feed: "recent" });
  await loadAll(page);
  const recent = await mockTitles(page);
  expect(recent[0]).toBe(MOCK_EXPECT.newest[0]);
  expectInOrder(recent, MOCK_EXPECT.newest);

  // Popular in the last month.
  await openFeed(page, { feed: "popular", period: "month" });
  await expect.poll(async () => (await mockTitles(page))[0]).toBe(MOCK_EXPECT.bestMonth[0]);
  await loadAll(page);
  const month = await mockTitles(page);
  expectInOrder(month, MOCK_EXPECT.bestMonth);
  for (const old of MOCK_EXPECT.olderThanMonth) expect(month).not.toContain(old);
});

test("votes: upvote adds one to the score and lights its thumb; downvote swaps the vote (net -2)", async ({ page, request }) => {
  await page.goto("/");
  await signIn(page, scoped("voter"));
  await openFeed(page, { feed: "recent" });
  await loadAll(page);
  const card = page.getByTestId("meme-card").filter({ hasText: MOCK_EXPECT.controversial.title });
  await expect(card).toHaveCount(1);

  const score = card.getByTestId("meme-score");
  const up = card.getByTestId("vote-up");
  const down = card.getByTestId("vote-down");
  // Other specs and retries share the seeded DB and may have voted already, so assert relative to what is shown.
  // Positive scores show a "+".
  const shown = (n: number) => (n > 0 ? `+${n}` : String(n));
  const score0 = Number(await score.textContent());
  await expect(up).toHaveAttribute("aria-pressed", "false");
  await expect(down).toHaveAttribute("aria-pressed", "false");

  await up.click();
  await expect(score).toHaveText(shown(score0 + 1));
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await expect(down).toHaveAttribute("aria-pressed", "false");

  await down.click();
  await expect(score).toHaveText(shown(score0 - 1));
  await expect(up).toHaveAttribute("aria-pressed", "false");
  await expect(down).toHaveAttribute("aria-pressed", "true");

  // Persisted server-side.
  const id = await card.getAttribute("data-meme-id");
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`);
  expect(meme.score).toBe(score0 - 1);
  await page.reload();
  await openFeed(page, { feed: "recent" });
  await loadAll(page);
  const again = page.getByTestId("meme-card").filter({ hasText: MOCK_EXPECT.controversial.title });
  await expect(again.getByTestId("meme-score")).toHaveText(shown(score0 - 1));
  await expect(again.getByTestId("vote-down")).toHaveAttribute("aria-pressed", "true");
});

test("gallery lists only posted public memes", async ({ request }) => {
  const all = await apiGet<Paged<Meme>>(request, "/api/gallery?period=all&limit=100");
  const titles = all.items.map((m) => m.title);
  for (const hidden of MOCK_EXPECT.hidden) expect(titles).not.toContain(hidden);
});
