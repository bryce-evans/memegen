import type { Page } from "@playwright/test";
import { openFeed, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

const navIds = (page: Page) =>
  page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));

const userCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === "memegen.user");

test("sign-in gate: every URL asks to sign in first, then opens there; the login survives reloads until sign-out", async ({
  page,
}) => {
  await page.goto("/leaderboard");
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
  await expect(page.getByTestId("nav-create")).toHaveCount(0);

  const username = scoped("gatekeeper");
  await signIn(page, username);
  await expect(page).toHaveURL(/\/leaderboard$/);
  await expect(page.getByTestId("nav-leaderboard")).toHaveAttribute("aria-current", "page");
  expect((await userCookie(page))?.expires).toBeGreaterThan(Date.now() / 1000);

  await page.reload();
  await expect(page.getByTestId("current-user")).toContainText(username);

  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
  expect(await userCookie(page)).toBeUndefined();
  await page.reload();
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
});

test("dev tools: the sign-in page's skin switcher restyles the app, and the choice outlasts sign-in and reloads", async ({
  page,
}) => {
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-skin", "default");

  await page.getByTestId("dev-skin").selectOption("google");
  await expect(root).toHaveAttribute("data-skin", "google");

  await signIn(page, scoped("stylist"));
  await expect(page.getByTestId("current-user")).toBeVisible();
  await expect(root).toHaveAttribute("data-skin", "google");
  await expect(page.getByTestId("dev-tools")).toHaveCount(0);
  await page.reload();
  await expect(root).toHaveAttribute("data-skin", "google");
});

test("dark mode: a profile setting for skins with a dark variant, kept in this browser per user", async ({ page }) => {
  const username = scoped("nightowl");
  await page.goto("/");
  const root = page.locator("html");
  await signIn(page, username);

  // The default skin has no dark variant, so Settings has nothing to set for it.
  await page.goto(`/u/${username}?tab=settings`);
  await expect(page.getByTestId("profile-settings")).toBeVisible();
  await expect(page.getByTestId("dark-mode-on")).toHaveCount(0);

  await page.goto(`/u/${username}?tab=settings&skin=painted`);
  await expect(root).toHaveAttribute("data-skin", "painted");
  await expect(page.getByTestId("dark-mode-off")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("dark-mode-on").click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");

  // Another user in the same browser starts light, and the first gets theirs back.
  await page.getByTestId("sign-out").click();
  await expect(root).not.toHaveAttribute("data-theme", "dark");
  await signIn(page, scoped("earlybird"));
  await expect(root).not.toHaveAttribute("data-theme", "dark");
  await page.getByTestId("sign-out").click();
  await signIn(page, username);
  await expect(root).toHaveAttribute("data-theme", "dark");

  await page.goto(`/u/${username}?tab=settings`);
  await page.getByTestId("dark-mode-off").click();
  await expect(root).not.toHaveAttribute("data-theme", "dark");
});

test("card layout: a profile setting, on hover by default, Google-style puts the info below each meme", async ({ page }) => {
  const username = scoped("cardsharp");
  await page.goto("/");
  await signIn(page, username);
  const grid = page.getByTestId("meme-grid");

  // On hover (the default) the card carries the author, age, and favorite star.
  await openFeed(page, { feed: "recent" });
  await expect(grid).toHaveAttribute("data-card-layout", "hover");
  const first = page.getByTestId("meme-card").first();
  await expect(first.getByTestId("meme-author")).toHaveCount(1);
  await expect(first.getByTestId("favorite")).toHaveCount(1);

  await page.goto(`/u/${username}?tab=settings`);
  await expect(page.getByTestId("card-layout-hover")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("card-layout-below").click();
  await expect(page.getByTestId("card-layout-below")).toHaveAttribute("aria-pressed", "true");

  // Google-style: the title sits under the image, not over it, and the author, age, and favorite star are left out.
  await openFeed(page, { feed: "recent" });
  await expect(grid).toHaveAttribute("data-card-layout", "below");
  const card = page.getByTestId("meme-card").first();
  const media = await card.getByTestId("meme-card-media").boundingBox();
  const title = await card.getByTestId("meme-card-title").boundingBox();
  expect(media && title && title.y >= media.y + media.height).toBe(true);
  await expect(card.getByTestId("meme-author")).toHaveCount(0);
  await expect(card.getByTestId("meme-age")).toHaveCount(0);
  await expect(card.getByTestId("favorite")).toHaveCount(0);
  await page.reload();
  await expect(grid).toHaveAttribute("data-card-layout", "below");
});

test("sidebar nav: entries in order, each opens its page", async ({ page }) => {
  const username = scoped("navigator");
  await page.goto("/");
  await signIn(page, username);
  expect(await navIds(page)).toEqual(["nav-create", "nav-recent", "nav-popular", "nav-leaderboard", "nav-profile"]);

  const routes: [string, RegExp][] = [
    ["nav-create", /\/create$/],
    ["nav-recent", /\/recent$/],
    ["nav-popular", /\/$/],
    ["nav-leaderboard", /\/leaderboard$/],
    ["nav-profile", new RegExp(`/u/${username}$`)],
  ];
  for (const [id, url] of routes) {
    await page.getByTestId(id).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId(id)).toHaveAttribute("aria-current", "page");
  }
});

test("narrow screens: Create beside a Gallery dropdown of the feeds; Profile and Sign out under the account button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const username = scoped("pocket");
  await page.goto("/");
  await signIn(page, username);
  const gallery = page.getByTestId("gallery-menu");
  const account = page.getByTestId("account-button");

  // Create is in the row; both dropdowns start closed; the period filter moves beside the feed title.
  await expect(page.getByTestId("nav-create")).toBeVisible();
  await expect(page.getByTestId("nav-leaderboard")).toBeHidden();
  await expect(page.getByTestId("sign-out")).toBeHidden();
  await expect(page.getByTestId("period-week")).toBeVisible();

  // The Gallery dropdown holds the feeds only; choosing one navigates and closes it.
  await gallery.click();
  await expect(gallery).toHaveAttribute("aria-expanded", "true");
  for (const id of ["nav-recent", "nav-popular", "nav-leaderboard"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("nav-profile")).toBeHidden();
  await page.getByTestId("nav-leaderboard").click();
  await expect(page).toHaveURL(/\/leaderboard$/);
  await expect(page.getByTestId("nav-leaderboard")).toBeHidden();

  // Escape closes it and returns focus to the button; so does a click outside.
  await gallery.click();
  await expect(page.getByTestId("nav-recent")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nav-recent")).toBeHidden();
  await expect(gallery).toBeFocused();
  await gallery.click();
  await page.getByTestId("meme-search").click();
  await expect(page.getByTestId("nav-recent")).toBeHidden();

  // Profile moved to the account dropdown.
  await account.click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
  await page.getByTestId("nav-profile").click();
  await expect(page).toHaveURL(new RegExp(`/u/${username}$`));
  await expect(page.getByTestId("sign-out")).toBeHidden();

  await account.click();
  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
});

test("a stored user the server no longer knows (e.g. after a DB reset) is signed out back to the sign-in page", async ({
  page,
  baseURL,
}) => {
  const ghost = { id: crypto.randomUUID(), username: "ghost", createdAt: new Date().toISOString() };
  await page.context().addCookies([{ name: "memegen.user", value: encodeURIComponent(JSON.stringify(ghost)), url: baseURL! }]);
  await page.goto("/recent");
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
  expect(await userCookie(page)).toBeUndefined();

  // Signing in again works and lands on the same feed.
  await signIn(page, scoped("revenant"));
  await openFeed(page, { feed: "recent" });
  await expect(page.getByTestId("meme-card").first()).toBeVisible();
});
