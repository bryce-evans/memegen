import { expect, scoped, test } from "./test.ts";
import type { Meme, Template } from "@memegen/shared";
import { apiGet, apiUpload, apiUser, fixture, memeIdFromUrl, signIn } from "./helpers.ts";

test("templates: add one, add a variation, add tags, use the variation with a new team tag, find it all by tag", async ({
  page,
  request,
}) => {
  const curator = scoped("curator");
  const base = scoped("E2E Base");
  const teamTag = scoped("Adobe Memes");
  const teamSlug = teamTag.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await page.goto("/");
  await signIn(page, curator);
  await page.getByTestId("nav-create").click();

  // Add a template; the start view returns to search with its name filled in.
  await page.getByTestId("create-mode-new").click();
  await page.getByTestId("new-template-name").fill(base);
  await page.getByTestId("new-template-file").setInputFiles(fixture("still.png"));
  await page.getByTestId("new-template-submit").click();
  await expect(page.getByTestId("create-mode-search")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("template-search")).toHaveValue(base);
  const card = page.getByTestId("template-card").filter({ hasText: base });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("template-author")).toContainText(`@${curator}`);
  await expect(card.getByTestId("template-use-count")).toHaveText("0🔥");
  await expect(card.getByTestId("template-use-count")).toHaveAttribute("aria-label", "used 0 times");

  await card.getByTestId("add-variation").setInputFiles(fixture("anim.gif"));
  await expect(card.getByTestId("variation-item")).toHaveCount(1);

  // Tags added after creation are community tags, not base tags.
  await card.getByTestId("template-tags-add").click();
  await card.getByTestId("tags-input").fill("movie");
  await card.getByTestId("tags-input").press("Enter");
  await card.getByTestId("tags-save").click();
  const movieChip = card.locator('[data-testid="tag-chip"][data-tag="movie"]');
  await expect(movieChip).toBeVisible();
  await expect(movieChip).not.toHaveAttribute("data-base", "true");

  // Use the (animated) variation: the editor opens on it with every frame.
  await card.getByTestId("variation-item").click();
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("timeline-frame")).toHaveCount(12);
  await page.getByTestId("meme-title").fill("From variation");

  // Team tags for an org's own memes: created while saving, and put on the meme.
  await page.getByTestId("new-tag-name").fill(teamTag);
  await page.getByTestId("new-tag-kind").selectOption("team");
  await page.getByTestId("new-tag-submit").click();
  await expect(page.locator(`[data-testid="tag-input-chip"][data-tag="${teamSlug}"]`)).toBeVisible();
  await page.getByTestId("post-meme").click();
  const id = await memeIdFromUrl(page);

  const user = await apiUser(request, curator);
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.tags).toEqual([teamSlug]); // the template's tags are inherited, not copied

  // The meme is found under the template's tag; the parent template too.
  await page.getByTestId("tag-search").fill("mov");
  await page.locator('[data-testid="tag-suggestion"][data-tag="movie"]').click();
  await expect(page).toHaveURL(/\/t\/movie$/);
  await expect(page.getByTestId("tag-title")).toContainText(/movie/i);
  await expect(page.getByTestId("tag-templates")).toContainText(base);
  await expect(page.getByTestId("tag-memes").locator(`[data-meme-id="${id}"]`)).toBeVisible();

  // And under the new team tag.
  await page.goto(`/t/${teamSlug}`);
  await expect(page.getByTestId("tag-title")).toContainText(teamTag);
  await expect(page.getByTestId("tag-memes").locator(`[data-meme-id="${id}"]`)).toBeVisible();

  // Hot templates and the card's use count include the use (variation rolls up into the parent).
  await page.getByTestId("nav-create").click();
  await page.getByTestId("hot-period-day").click();
  const hot = page.getByTestId("hot-template").filter({ hasText: base });
  await expect(hot.getByTestId("hot-uses")).toHaveText("1");
  await page.getByTestId("template-search").fill(base);
  await expect(card.getByTestId("template-use-count")).toHaveText("1🔥");
});

test("templates: another user can add tags but the author's base tags stay marked", async ({ page, request }) => {
  const author = await apiUser(request, scoped("tag-author"));
  const asset = await apiUpload(request, author, "still.png");
  const name = scoped("E2E Tagged");
  const res = await request.post("/api/templates", {
    headers: { "x-user-id": author.id },
    data: { name, assetId: asset.id, tags: ["oldschool"] },
  });
  expect(res.status(), await res.text()).toBe(201);
  const template = (await res.json()) as Template;
  expect(template.baseTags).toEqual(["oldschool"]);

  await page.goto("/create");
  await signIn(page, scoped("tag-helper"));
  await page.getByTestId("template-search").fill(name);
  const card = page.locator(`[data-testid="template-card"][data-template-id="${template.id}"]`);
  await expect(card.locator('[data-testid="tag-chip"][data-tag="oldschool"]')).toHaveAttribute("data-base", "true");

  await card.getByTestId("template-tags-add").click();
  await card.getByTestId("tags-input").fill("reaction");
  await card.getByTestId("tags-input").press("Enter");
  await card.getByTestId("tags-save").click();
  await expect(card.locator('[data-testid="tag-chip"][data-tag="reaction"]')).toBeVisible();
  await expect(card.locator('[data-testid="tag-chip"][data-tag="reaction"]')).not.toHaveAttribute("data-base", "true");
  await expect(card.locator('[data-testid="tag-chip"][data-tag="oldschool"]')).toHaveAttribute("data-base", "true");

  const after = await apiGet<Template>(request, `/api/templates/${template.id}`);
  expect(after.tags).toEqual(["oldschool", "reaction"]);
  expect(after.baseTags).toEqual(["oldschool"]);
});
