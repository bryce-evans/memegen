import type { Meme, Page as Paged } from "@memegen/shared";
import { MOCK_EXPECT } from "../scripts/mock/data.ts";
import { apiGet, expectInOrder, loadAll, mockTitles, setFilters, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("gallery: sort by popular and by date, hottest in the last month; hidden memes stay hidden", async ({ page }) => {
  await page.goto("/");

  // Popular (best) over all time.
  await setFilters(page, { period: "all", sort: "best" });
  await expect.poll(async () => (await mockTitles(page))[0]).toBe(MOCK_EXPECT.bestAllTime[0]);
  await loadAll(page);
  const popular = await mockTitles(page);
  expectInOrder(popular, MOCK_EXPECT.bestAllTime);
  for (const hidden of MOCK_EXPECT.hidden) expect(popular).not.toContain(hidden);

  // By date (newest first).
  await setFilters(page, { sort: "new" });
  await expect.poll(async () => (await mockTitles(page))[0]).toBe(MOCK_EXPECT.newest[0]);
  await loadAll(page);
  expectInOrder(await mockTitles(page), MOCK_EXPECT.newest);

  // Hottest in the last month.
  await setFilters(page, { period: "month", sort: "best" });
  await expect.poll(async () => (await mockTitles(page))[0]).toBe(MOCK_EXPECT.bestMonth[0]);
  await loadAll(page);
  const month = await mockTitles(page);
  expectInOrder(month, MOCK_EXPECT.bestMonth);
  for (const old of MOCK_EXPECT.olderThanMonth) expect(month).not.toContain(old);
});

test("votes: upvote adds one; downvote then removes it and adds a downvote (-2 → -3)", async ({ page, request }) => {
  await page.goto("/");
  await signIn(page, scoped("voter"));
  await setFilters(page, { period: "all", sort: "new" });
  await loadAll(page);
  const card = page.getByTestId("meme-card").filter({ hasText: MOCK_EXPECT.controversial.title });
  await expect(card).toHaveCount(1);

  const up = card.getByTestId("upvote-count");
  const down = card.getByTestId("downvote-count");
  // Downvotes display as a negative number. Other skins' runs may have voted already,
  // so assert relative to what is shown (the fresh dataset starts at 1 / -2).
  const up0 = Number(await up.textContent());
  const down0 = Number(await down.textContent());
  expect(down0).toBeLessThanOrEqual(-MOCK_EXPECT.controversial.down);

  await card.getByTestId("vote-up").click();
  await expect(up).toHaveText(String(up0 + 1));
  await expect(down).toHaveText(String(down0));

  await card.getByTestId("vote-down").click();
  await expect(up).toHaveText(String(up0));
  await expect(down).toHaveText(String(down0 - 1));

  // Persisted server-side.
  const id = await card.getAttribute("data-meme-id");
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`);
  expect([meme.upvotes, -meme.downvotes]).toEqual([up0, down0 - 1]);
  await page.reload();
  await setFilters(page, { period: "all", sort: "new" });
  await loadAll(page);
  const again = page.getByTestId("meme-card").filter({ hasText: MOCK_EXPECT.controversial.title });
  await expect(again.getByTestId("downvote-count")).toHaveText(String(down0 - 1));
});

test("gallery lists only posted public memes", async ({ request }) => {
  const all = await apiGet<Paged<Meme>>(request, "/api/gallery?period=all&limit=100");
  const titles = all.items.map((m) => m.title);
  for (const hidden of MOCK_EXPECT.hidden) expect(titles).not.toContain(hidden);
});
