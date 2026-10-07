import { topBottomLayers, type Template } from "@memegen/shared";
import { MOCK_EXPECT, MOCK_TEMPLATES } from "../scripts/mock/data.ts";
import { apiGet, apiMeme, apiPost, apiUpload, apiUser, loadAll, memeCard, mockTitles, openFeed, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("profile: open an author from the gallery and see their stats, badges and public memes", async ({ page }) => {
  await page.goto("/recent");
  await signIn(page, scoped("visitor"));
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
  await signIn(page, scoped("counter"));
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
  await expect(tabs).toHaveCount(4);
  expect(await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")))).toEqual([
    "profile-tab-memes",
    "profile-tab-templates",
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

test("profile templates: everyone sees the tab; the author opens one, edits its name and default text, and saves", async ({
  page,
  request,
}) => {
  const author = await apiUser(request, scoped("template-author"));
  const name = scoped("Editable");
  const asset = await apiUpload(request, author, "still.png");
  const template = await apiPost<Template>(request, "/api/templates", author, {
    name,
    assetId: asset.id,
    defaultLayers: topBottomLayers("FIRST TOP", "FIRST BOTTOM"),
  });
  const hidden = await apiPost<Template>(request, "/api/templates", author, {
    name: scoped("Hidden draft"),
    assetId: asset.id,
    isPublic: false,
  });
  const card = (id: string) => page.locator(`[data-testid="template-card"][data-template-id="${id}"]`);

  // A visitor sees the public template with Use, not Edit, and never the private one.
  await page.goto(`/u/${author.username}?tab=templates`);
  await signIn(page, scoped("template-visitor"));
  const grid = page.getByTestId("profile-templates");
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("profile-tab-templates")).toHaveAttribute("aria-pressed", "true");
  await expect(card(template.id).getByTestId("use-template")).toBeVisible();
  await expect(card(template.id).getByTestId("edit-template")).toHaveCount(0);
  await expect(card(hidden.id)).toHaveCount(0);

  // The author sees both, and Edit opens the template editor with its stored default text.
  await page.getByTestId("sign-out").click();
  await signIn(page, author.username);
  await expect(grid).toHaveAttribute("aria-busy", "false");
  await expect(card(hidden.id)).toBeVisible();
  await card(template.id).getByTestId("edit-template").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?editTemplate=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("editor-title")).toHaveText("Edit template");
  await expect(page.getByTestId("template-name")).toHaveValue(name);
  await expect(page.getByTestId("template-update")).toBeDisabled(); // nothing changed yet

  const renamed = scoped("Edited");
  await page.getByTestId("template-name").fill(renamed);
  await page.getByTestId("layer-text").first().fill("EDITED TOP");
  await expect(page.getByTestId("template-status")).toHaveAttribute("data-dirty", "true");
  await page.getByTestId("template-update").click();
  await expect(page.getByTestId("template-status")).toHaveAttribute("data-dirty", "false");

  const saved = await apiGet<Template>(request, `/api/templates/${template.id}`);
  expect(saved.name).toBe(renamed);
  expect(saved.defaultLayers.map((l) => (l.type === "text" ? l.text : l.type))).toEqual(["EDITED TOP", "FIRST BOTTOM"]);
});
