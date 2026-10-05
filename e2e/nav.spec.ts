import type { Page } from "@playwright/test";
import { openFeed, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

const navIds = (page: Page) =>
  page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));

test("sidebar nav: browse entries in order, profile only when signed in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-create")).toBeVisible();
  expect(await navIds(page)).toEqual(["nav-create", "nav-recent", "nav-popular", "nav-leaderboard"]);

  const username = scoped("navigator");
  await signIn(page, username);
  await expect(page.getByTestId("nav-profile")).toBeVisible();
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

test("a stored user the server no longer knows (e.g. after a DB reset) is signed out and feeds load", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "memegen.user",
      JSON.stringify({ id: crypto.randomUUID(), username: "ghost", createdAt: new Date().toISOString() }),
    ),
  );
  await page.reload();
  await openFeed(page, { feed: "recent" });

  await expect(page.getByTestId("meme-card").first()).toBeVisible();
  await expect(page.getByTestId("nav-profile")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("memegen.user"))).toBeNull();
});
