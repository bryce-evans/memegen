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
