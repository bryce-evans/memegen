import { MOCK_EXPECT } from "../scripts/mock/data.ts";
import { apiMeme, apiUser, loadAll, mockTitles, openFeed, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("profile: open an author from the gallery and see their stats, badges and public memes", async ({ page }) => {
  await page.goto("/recent");
  await openFeed(page, { feed: "popular", period: "week" });
  const card = page.getByTestId("meme-card").filter({ hasText: "Mock: Top of the Week" });
  await card.getByRole("link", { name: "mock-alice" }).click();
  await expect(page).toHaveURL(/\/u\/mock-alice$/);

  await expect(page.getByTestId("stat-meme-count")).toHaveText(String(MOCK_EXPECT.aliceStats.memeCount));
  await expect(page.getByTestId("stat-high-score")).toHaveText(String(MOCK_EXPECT.aliceStats.highScore));
  await expect(page.getByTestId("stat-h-score")).toHaveText(String(MOCK_EXPECT.aliceStats.hScore));

  // 6 memes / high score 8 / h-score 3: bronze meme maker and bronze h-score, no high-score badge yet.
  const badges = page.getByTestId("profile-badge");
  await expect(badges).toHaveCount(2);
  expect(await badges.evaluateAll((els) => els.map((el) => el.getAttribute("data-badge")))).toEqual([
    "memeCount-bronze",
    "hScore-bronze",
  ]);
  await expect(badges.first()).toHaveAttribute("title", /\S/);

  // Liked/disliked are the owner's own; visitors only get the memes.
  await expect(page.getByTestId("profile-tab-liked")).toHaveCount(0);
  await loadAll(page);
  const titles = await mockTitles(page);
  expect([...titles].sort()).toEqual([...MOCK_EXPECT.alicePublicTitles].sort());
});

test("profile: liked and disliked tabs list the owner's votes; favorites is the liked tab", async ({ page, request }) => {
  const author = await apiUser(request, scoped("tastemaker"));
  const liked = await apiMeme(request, author, { title: scoped("Vote me up") });
  const disliked = await apiMeme(request, author, { title: scoped("Vote me down") });
  const voter = scoped("critic");
  const cardOf = (id: string) => page.locator(`[data-testid="meme-card"][data-meme-id="${id}"]`);

  await page.goto(`/m/${liked.id}`);
  await signIn(page, voter);
  await page.getByTestId("vote-up").click();
  await expect(page.getByTestId("vote-up")).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/m/${disliked.id}`);
  await page.getByTestId("vote-down").click();
  await expect(page.getByTestId("vote-down")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("nav-favorites").click();
  await expect(page).toHaveURL(new RegExp(`/u/${voter}\\?tab=liked$`));
  await expect(page.getByTestId("nav-favorites")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("nav-profile")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("profile-tab-liked")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("meme-feed")).toHaveAttribute("aria-busy", "false");
  await expect(cardOf(liked.id)).toBeVisible();
  await expect(cardOf(disliked.id)).toHaveCount(0);

  await page.getByTestId("profile-tab-disliked").click();
  await expect(page).toHaveURL(/\?tab=disliked$/);
  await expect(page.getByTestId("meme-feed")).toHaveAttribute("aria-busy", "false");
  await expect(cardOf(disliked.id)).toBeVisible();
  await expect(cardOf(liked.id)).toHaveCount(0);

  await page.getByTestId("nav-profile").click();
  await expect(page.getByTestId("nav-profile")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("nav-favorites")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("profile-tab-memes")).toHaveAttribute("aria-pressed", "true");

  // Someone else opening the liked tab only sees the voter's (empty) memes.
  await page.getByTestId("sign-out").click();
  await signIn(page, scoped("snoop"));
  await page.goto(`/u/${voter}?tab=liked`);
  await expect(page.getByTestId("meme-feed")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("profile-tab-liked")).toHaveCount(0);
  await expect(cardOf(liked.id)).toHaveCount(0);
});
