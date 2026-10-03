import { expect, scoped, test } from "./test.ts";
import type { Meme } from "@memegen/shared";
import { apiGet, apiUser, fixture, memeIdFromUrl, signIn } from "./helpers.ts";

test("templates: create, add a variation, tag, use the variation, find it all by tag", async ({ page, request }) => {
  const base = scoped("E2E Base");
  const teamTag = scoped("Adobe Memes");
  const teamSlug = teamTag.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await page.goto("/");
  await signIn(page, scoped("curator"));
  await page.getByTestId("nav-templates").click();

  await page.getByTestId("new-template-name").fill(base);
  await page.getByTestId("new-template-file").setInputFiles(fixture("still.png"));
  await page.getByTestId("new-template-submit").click();
  await page.getByTestId("template-search").fill(base);
  const card = page.getByTestId("template-card").filter({ hasText: base });
  await expect(card).toHaveCount(1);

  await card.getByTestId("add-variation").setInputFiles(fixture("anim.gif"));
  await expect(card.getByTestId("variation-item")).toHaveCount(1);

  await card.getByTestId("template-tags-edit").click();
  await card.getByTestId("tags-input").fill("movie");
  await card.getByTestId("tags-input").press("Enter");
  await card.getByTestId("tags-save").click();
  await expect(card.locator('[data-testid="tag-chip"][data-tag="movie"]')).toBeVisible();

  // Use the (animated) variation: the editor opens on it with every frame.
  await card.getByTestId("variation-item").click();
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("timeline-frame")).toHaveCount(12);
  await page.getByTestId("meme-title").fill("From variation");
  await page.getByTestId("post-meme").click();
  const id = await memeIdFromUrl(page);

  const user = await apiUser(request, scoped("curator"));
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.tags).toEqual([]); // inherited, not copied

  // The meme is found under the template's tag; the parent template too.
  await page.getByTestId("tag-search").fill("mov");
  await page.locator('[data-testid="tag-suggestion"][data-tag="movie"]').click();
  await expect(page).toHaveURL(/\/t\/movie$/);
  await expect(page.getByTestId("tag-title")).toContainText(/movie/i);
  await expect(page.getByTestId("tag-templates")).toContainText(base);
  await expect(page.getByTestId("tag-memes").locator(`[data-meme-id="${id}"]`)).toBeVisible();

  // Hot templates count the use (variation rolls up into the parent).
  await page.getByTestId("nav-templates").click();
  await page.getByTestId("hot-period-day").click();
  const hot = page.getByTestId("hot-template").filter({ hasText: base });
  await expect(hot.getByTestId("hot-uses")).toHaveText("1");

  // Team tags for an org's own memes.
  await page.getByTestId("new-tag-name").fill(teamTag);
  await page.getByTestId("new-tag-kind").selectOption("team");
  await page.getByTestId("new-tag-submit").click();
  await expect(page).toHaveURL(new RegExp(`/t/${teamSlug}$`));
  await expect(page.getByTestId("tag-title")).toContainText(teamTag);
});
