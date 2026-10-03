import { expect, scoped, test } from "./test.ts";
import type { Meme, Template, TemplateUsage } from "@memegen/shared";
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

  // Add a template: upload, then place its default text in the Template Editor (top/bottom preset).
  await page.getByTestId("new-template-file").setInputFiles(fixture("still.png"));
  await expect(page).toHaveURL(/\/create\?newTemplate=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("editor-title")).toHaveText("Template Editor");
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  const layers = page.getByTestId("layer-item");
  await expect(layers).toHaveCount(2);
  await layers.nth(0).click();
  await expect(page.getByTestId("layer-text")).toHaveValue("TOP TEXT");
  await page.getByTestId("layer-text").fill("when the template");
  await layers.nth(1).click();
  await expect(page.getByTestId("layer-text")).toHaveValue("BOTTOM TEXT");

  await expect(page.getByTestId("template-name")).toHaveValue("still");
  await page.getByTestId("template-name").fill(base);
  await page.getByTestId("template-tags").fill("e2e-base");
  await page.getByTestId("template-tags").press("Enter");
  await page.getByTestId("template-save").click();
  const confirm = page.getByTestId("template-confirm-dialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Add new template?");
  await confirm.getByTestId("template-confirm").click();

  // Saved: the editor opens the new template, with the placed text as its defaults.
  await expect(page).toHaveURL(/\/create\?template=[0-9a-f-]{36}$/);
  const templateId = new URL(page.url()).searchParams.get("template")!;
  const saved = await apiGet<Template>(request, `/api/templates/${templateId}`);
  expect(saved.defaultLayers.map((l) => l.text)).toEqual(["when the template", "BOTTOM TEXT"]);
  expect(saved.baseTags).toEqual(["e2e-base"]);

  await page.getByTestId("nav-create").click();
  await page.getByTestId("template-search").fill(base);
  const card = page.getByTestId("template-card").filter({ hasText: base });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("template-author")).toContainText(`@${curator}`);
  await expect(card.getByTestId("template-use-count")).toHaveText("0🔥");
  await expect(card.getByTestId("template-use-count")).toHaveAttribute("aria-label", "used 0 times");
  // The gallery card is just the template and Use: tags, usage and variations live in the editor.
  await expect(card.getByTestId("tag-chip")).toHaveCount(0);
  await expect(card.getByTestId("template-tags-add")).toHaveCount(0);
  await expect(card.getByTestId("use-template")).toBeVisible();

  // An animated variation (the UI no longer uploads variations; the API still does).
  const user = await apiUser(request, curator);
  const parentId = await card.getAttribute("data-template-id");
  const gif = await apiUpload(request, user, "anim.gif");
  const variation = await request.post("/api/templates", {
    headers: { "x-user-id": user.id },
    data: { name: `${base} (anim)`, assetId: gif.id, parentId },
  });
  expect(variation.status(), await variation.text()).toBe(201);

  // Use opens the editor; tags, usage and variations sit under the stage.
  await card.getByTestId("use-template").click();
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  const details = page.getByTestId("template-details");
  await expect(details.locator('[data-testid="tag-chip"][data-tag="e2e-base"]')).toHaveAttribute("data-base", "true");
  await expect(details.getByTestId("usage-chart")).toBeVisible();

  // Tags added after creation are community tags, not base tags.
  await details.getByTestId("template-tags-add").click();
  await details.getByTestId("tags-input").fill("movie");
  await details.getByTestId("tags-input").press("Enter");
  await details.getByTestId("tags-save").click();
  const movieChip = details.locator('[data-testid="tag-chip"][data-tag="movie"]');
  await expect(movieChip).toBeVisible();
  await expect(movieChip).not.toHaveAttribute("data-base", "true");

  // Use the (animated) variation: the editor opens on it with every frame.
  await expect(details.getByTestId("variation-item")).toHaveCount(1);
  await details.getByTestId("variation-item").click();
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

  // The template's tags are inherited, not copied.
  const meme = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(meme.tags).toEqual([teamSlug]);

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

  // The use counts toward the parent template (the variation rolls up). Checked on its own usage series: the Hot
  // row only shows today's top 12, and the other skins' runs use plenty of templates today too.
  const usage = await apiGet<TemplateUsage>(request, `/api/templates/${templateId}/usage?period=day`);
  expect(usage.points.reduce((n, p) => n + p.uses, 0)).toBe(1);
  await page.getByTestId("nav-create").click();
  await expect(page.getByTestId("hot-template").first()).toBeVisible();
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
  await page.locator(`[data-testid="template-card"][data-template-id="${template.id}"]`).getByTestId("use-template").click();
  const details = page.getByTestId("template-details");
  await expect(details.locator('[data-testid="tag-chip"][data-tag="oldschool"]')).toHaveAttribute("data-base", "true");

  await details.getByTestId("template-tags-add").click();
  await details.getByTestId("tags-input").fill("reaction");
  await details.getByTestId("tags-input").press("Enter");
  await details.getByTestId("tags-save").click();
  await expect(details.locator('[data-testid="tag-chip"][data-tag="reaction"]')).toBeVisible();
  await expect(details.locator('[data-testid="tag-chip"][data-tag="reaction"]')).not.toHaveAttribute("data-base", "true");
  await expect(details.locator('[data-testid="tag-chip"][data-tag="oldschool"]')).toHaveAttribute("data-base", "true");

  const after = await apiGet<Template>(request, `/api/templates/${template.id}`);
  expect(after.tags).toEqual(["oldschool", "reaction"]);
  expect(after.baseTags).toEqual(["oldschool"]);
});
