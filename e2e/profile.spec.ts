import { MOCK_EXPECT, MOCK_TEMPLATES } from "../scripts/mock/data.ts";
import { apiMeme, apiUser, loadAll, memeCard, mockTitles, openFeed, signIn } from "./helpers.ts";
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

  // Favorites and recent activity are the owner's own; visitors only get the memes.
  await expect(page.getByTestId("profile-tab-favorites")).toHaveCount(0);
  await loadAll(page);
  const titles = await mockTitles(page);
  expect([...titles].sort()).toEqual([...MOCK_EXPECT.alicePublicTitles].sort());
});

test("profile: shows how many templates the user contributed", async ({ page }) => {
  const carolTemplates = MOCK_TEMPLATES.filter((t) => t.owner === "mock-carol").length;
  await page.goto("/u/mock-carol");
  await expect(page.getByTestId("stat-template-count")).toHaveText(String(carolTemplates));
  await page.goto("/u/mock-alice");
  await expect(page.getByTestId("stat-template-count")).toHaveText("0");
});

test("profile: memes, favorites (starred), then recent activity (likes and dislikes, newest first)", async ({ page, request }) => {
  const author = await apiUser(request, scoped("tastemaker"));
  const liked = await apiMeme(request, author, { title: scoped("Vote me up") });
  const disliked = await apiMeme(request, author, { title: scoped("Vote me down") });
  const starred = await apiMeme(request, author, { title: scoped("Star me") });
  const voter = scoped("critic");
  const own = await apiMeme(request, await apiUser(request, voter), { title: scoped("My own") });

  await page.goto(`/m/${liked.id}`);
  await signIn(page, voter);
  await page.getByTestId("vote-up").click();
  await expect(page.getByTestId("vote-up")).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/m/${disliked.id}`);
  await page.getByTestId("vote-down").click();
  await expect(page.getByTestId("vote-down")).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/m/${starred.id}`);
  await page.getByTestId("favorite").click();
  await expect(page.getByTestId("favorite")).toHaveAttribute("aria-pressed", "true");
  // No star on your own memes.
  await page.goto(`/m/${own.id}`);
  await expect(page.getByTestId("vote-up")).toBeVisible();
  await expect(page.getByTestId("favorite")).toHaveCount(0);

  await page.getByTestId("nav-profile").click();
  const tabs = page.locator('[data-testid^="profile-tab-"]');
  await expect(tabs).toHaveCount(3);
  expect(await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")))).toEqual([
    "profile-tab-memes",
    "profile-tab-favorites",
    "profile-tab-activity",
  ]);
  await expect(page.getByTestId("profile-tab-memes")).toHaveAttribute("aria-pressed", "true");

  const feed = page.getByTestId("meme-feed");
  await page.getByTestId("profile-tab-favorites").click();
  await expect(page).toHaveURL(/\?tab=favorites$/);
  await expect(feed).toHaveAttribute("data-tab", "favorites");
  await expect(feed).toHaveAttribute("aria-busy", "false");
  await expect(memeCard(page, starred.id)).toBeVisible();
  await expect(memeCard(page, starred.id).getByTestId("favorite")).toHaveAttribute("aria-pressed", "true");
  await expect(memeCard(page, liked.id)).toHaveCount(0); // a like is not a favorite

  await page.getByTestId("profile-tab-activity").click();
  await expect(page).toHaveURL(/\?tab=activity$/);
  await expect(feed).toHaveAttribute("data-tab", "activity");
  await expect(feed).toHaveAttribute("aria-busy", "false");
  const ids = await page.getByTestId("meme-card").evaluateAll((els) => els.map((el) => el.getAttribute("data-meme-id")));
  // Newest vote first (earlier runs of this spec may have left older votes below); starring alone is not activity.
  expect(ids.slice(0, 2)).toEqual([disliked.id, liked.id]);
  expect(ids).not.toContain(starred.id);
  await expect(memeCard(page, liked.id).getByTestId("vote-up")).toHaveAttribute("aria-pressed", "true");
  await expect(memeCard(page, disliked.id).getByTestId("vote-down")).toHaveAttribute("aria-pressed", "true");

  // Someone else opening those tabs only sees the voter's memes.
  await page.getByTestId("sign-out").click();
  await signIn(page, scoped("snoop"));
  await page.goto(`/u/${voter}?tab=favorites`);
  await expect(feed).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("profile-tab-favorites")).toHaveCount(0);
  await expect(memeCard(page, starred.id)).toHaveCount(0);
  await expect(memeCard(page, own.id)).toBeVisible();
});
