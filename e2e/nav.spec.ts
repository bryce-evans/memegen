import type { Page } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

const navIds = (page: Page) =>
  page.locator('[data-testid^="nav-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));

test("sidebar nav: browse entries in order, profile and favorites only when signed in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-create")).toBeVisible();
  expect(await navIds(page)).toEqual(["nav-create", "nav-recent", "nav-popular", "nav-leaderboard"]);

  const username = scoped("navigator");
  await signIn(page, username);
  await expect(page.getByTestId("nav-favorites")).toBeVisible();
  expect(await navIds(page)).toEqual([
    "nav-create",
    "nav-recent",
    "nav-popular",
    "nav-leaderboard",
    "nav-profile",
    "nav-favorites",
  ]);

  const routes: [string, RegExp][] = [
    ["nav-create", /\/create$/],
    ["nav-recent", /\/recent$/],
    ["nav-popular", /\/$/],
    ["nav-leaderboard", /\/leaderboard$/],
    ["nav-profile", new RegExp(`/u/${username}$`)],
    ["nav-favorites", new RegExp(`/u/${username}\\?tab=liked$`)],
  ];
  for (const [id, url] of routes) {
    await page.getByTestId(id).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId(id)).toHaveAttribute("aria-current", "page");
  }
  // On the liked tab only favorites is current, not profile too.
  await expect(page.getByTestId("nav-profile")).not.toHaveAttribute("aria-current", "page");
});
