import { apiMeme, apiUser, signIn, tagChip } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("meme page: Share copies the meme's link; the owner's actions sit in an 'Only visible to you' panel", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const owner = await apiUser(request, scoped("sharer"));
  const meme = await apiMeme(request, owner, { title: scoped("Shared"), tags: ["e2e-share"] });

  await page.goto(`/m/${meme.id}`);
  await signIn(page, scoped("passerby"));
  await expect(page.getByTestId("owner-actions")).toHaveCount(0);
  await page.getByTestId("share-meme").click();
  await expect(page.getByTestId("share-meme")).toHaveText("Copied link to clipboard!");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/m/${meme.id}`);
  await expect(page.getByTestId("share-meme")).toHaveText("Share");

  await page.getByTestId("sign-out").click();
  await signIn(page, owner.username);
  const panel = page.getByTestId("owner-actions");
  await expect(panel).toContainText("Only visible to you");
  for (const id of ["visibility-toggle", "edit-meme", "delete-meme"]) await expect(panel.getByTestId(id)).toBeVisible();

  await expect(tagChip(page, "e2e-share")).toBeVisible();
  await expect(page.getByTestId("edit-tags")).toHaveCount(0);
  await panel.getByTestId("edit-meme").click();
  await expect(page.getByTestId("meme-tags")).toBeVisible();
});

test("meme page: the age shows the full posting date and time in a tooltip on hover", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("dated"));
  const meme = await apiMeme(request, owner, { title: scoped("Dated") });

  await page.goto(`/m/${meme.id}`);
  await signIn(page, owner.username);
  const age = page.getByTestId("meme-age");
  await expect(age).toHaveText("just now");
  const full = new Date(meme.postedAt!).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
  await expect(page.getByRole("tooltip", { name: full })).toBeHidden();
  await age.hover();
  await expect(page.getByRole("tooltip", { name: full })).toBeVisible();
});

test("meme page: content stays in one column with public actions beside the heading and votes", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("layout"));
  const meme = await apiMeme(request, owner, { title: scoped("Single column"), tags: ["e2e-layout"] });
  await page.goto(`/m/${meme.id}`);
  await signIn(page, owner.username);

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const { meta, title, share, download, media, votes, template, comments, privateActions } = await page.evaluate(() => {
      const box = (id: string) => {
        const bounds = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      return {
        meta: box("meme-meta"), title: box("meme-title"), share: box("share-meme"), download: box("download-meme"),
        media: box("meme-media"), votes: box("meme-votes"), template: box("use-template"),
        comments: box("meme-comments"), privateActions: box("owner-actions"),
      };
    });
    expect(meta.y + meta.height).toBeLessThanOrEqual(title.y);
    expect(title.y + title.height).toBeLessThan(media.y);
    expect(share.y + share.height).toBeLessThan(media.y);
    expect(download.y + download.height).toBeLessThan(media.y);
    expect(media.y + media.height).toBeLessThan(votes.y);
    expect(media.y + media.height).toBeLessThan(template.y);
    expect(votes.y + votes.height).toBeLessThan(comments.y);
    expect(template.y + template.height).toBeLessThan(comments.y);
    expect(comments.y + comments.height).toBeLessThan(privateActions.y);
    if (width === 1280) {
      expect(share.x).toBeGreaterThan(title.x + title.width);
      expect(template.x).toBeGreaterThan(votes.x + votes.width);
      expect(template.y).toBeLessThan(votes.y + votes.height);
      expect(votes.y).toBeLessThan(template.y + template.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
