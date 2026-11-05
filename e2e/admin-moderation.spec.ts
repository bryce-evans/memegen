import { createSql } from "@memegen/server-kit";
import type { Comment, Meme, Template, User } from "@memegen/shared";
import { E2E_ENV } from "./environment.ts";
import { apiGet, apiMeme, apiPost, apiTemplate, apiUser, commentById, inputTagChip, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

async function setAdmin(user: User, isAdmin: boolean): Promise<void> {
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try {
    await sql`update users set is_admin = ${isAdmin} where id = ${user.id}`;
  } finally {
    await sql.end();
  }
}

test("admins moderate others' posts and comments; grants and revocations refresh from the server", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("admin-post-owner"));
  const moderator = await apiUser(request, scoped("admin-post-moderator"));
  const commenter = await apiUser(request, scoped("admin-comment-author"));
  const meme = await apiMeme(request, owner, { title: "Moderate this post", tags: ["before-moderation"] });
  const comment = await apiPost<Comment>(request, `/api/memes/${meme.id}/comments`, commenter, { body: "A removable comment" });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/m/${meme.id}`);
  await signIn(page, moderator.username);
  await expect(page.getByTestId("admin-actions")).toHaveCount(0);
  await expect(page.getByTestId("owner-actions")).toHaveCount(0);
  await expect(page.getByTestId("comment-delete")).toHaveCount(0);

  await setAdmin(moderator, true);
  await page.reload();
  const admin = page.getByTestId("admin-actions");
  await expect(admin).toBeVisible();
  await expect(page.getByTestId("owner-actions")).toHaveCount(0);
  await commentById(page, comment.id).getByTestId("comment-delete").click();
  await expect(commentById(page, comment.id)).toHaveCount(0);
  await inputTagChip(admin, "before-moderation").getByTestId("tag-input-chip-remove").click();
  await admin.getByTestId("admin-meme-tags").fill("moderated-topic");
  await admin.getByTestId("admin-meme-tags").press("Enter");
  await admin.getByTestId("admin-save-meme-tags").click();
  await expect.poll(async () => (await apiGet<Meme>(request, `/api/memes/${meme.id}`)).tags).toEqual(["moderated-topic"]);
  await admin.getByTestId("admin-visibility-toggle").click();
  await expect.poll(async () => (await apiGet<Meme>(request, `/api/memes/${meme.id}`)).visibility).toBe("unlisted");
  await admin.getByTestId("admin-edit-meme").click();
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("meme-title").fill("Edited by an administrator");
  await page.getByTestId("save-draft").click();
  await page.waitForURL(new RegExp(`/m/${meme.id}$`));
  const edited = await apiGet<Meme>(request, `/api/memes/${meme.id}`);
  expect(edited.title).toBe("Edited by an administrator");
  expect(edited.owner.id).toBe(owner.id);
  expect(edited.tags).toEqual(["moderated-topic"]);

  const draft = await apiMeme(request, owner, { title: "Admin can publish a draft", post: false });
  await page.goto(`/m/${draft.id}`);
  await page.getByTestId("admin-post-meme").click();
  await expect(page.getByTestId("admin-post-meme")).toHaveCount(0);
  expect((await apiGet<Meme>(request, `/api/memes/${draft.id}`)).postedAt).not.toBeNull();
  await page.getByTestId("admin-delete-meme").click();
  await expect.poll(async () => (await request.get(`/api/memes/${draft.id}`)).status()).toBe(404);

  const own = await apiMeme(request, moderator, { title: "Admin's own post" });
  await page.goto(`/m/${own.id}`);
  await expect(page.getByTestId("admin-actions")).toBeVisible();
  await expect(page.getByTestId("owner-actions")).toBeVisible();
  const adminBox = (await page.getByTestId("admin-actions").boundingBox())!;
  const ownerBox = (await page.getByTestId("owner-actions").boundingBox())!;
  expect(adminBox.y + adminBox.height).toBeLessThanOrEqual(ownerBox.y);
  await setAdmin(moderator, false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("owner-actions")).toBeVisible();
  await expect(page.getByTestId("admin-actions")).toHaveCount(0);
  const denied = await request.delete(`/api/memes/${meme.id}`, { headers: { "x-user-id": moderator.id } });
  expect(denied.status()).toBe(403);
});

test("template removal reviews direct and variation posts before individual or bulk deletion", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("admin-template-owner"));
  const moderator = await apiUser(request, scoped("admin-template-moderator"));
  const outsider = await apiUser(request, scoped("admin-template-outsider"));
  const template = await apiTemplate(request, owner, { name: "Template requiring review", tags: ["original-base"] });
  await apiPost(request, `/api/templates/${template.id}/tags`, outsider, { tags: ["community-tag"] }, 200);
  const variation = await apiTemplate(request, owner, { name: "Variation requiring review", parentId: template.id });
  const direct = await apiMeme(request, owner, { title: "Direct dependent post", templateId: template.id });
  const child = await apiMeme(request, outsider, { title: "Variation dependent post", templateId: variation.id });
  const hidden = await apiMeme(request, outsider, { title: "Private dependent draft", templateId: variation.id, post: false, visibility: "unlisted" });
  const unrelated = await apiMeme(request, outsider, { title: "Unrelated post is preserved" });
  await page.goto(`/create?template=${template.id}`);
  await signIn(page, moderator.username);
  await expect(page.getByTestId("template-admin-actions")).toHaveCount(0);
  await setAdmin(moderator, true);
  await page.reload();
  const admin = page.getByTestId("template-admin-actions");
  await expect(admin).toBeVisible();
  await inputTagChip(admin, "original-base").getByTestId("tag-input-chip-remove").click();
  await inputTagChip(admin, "community-tag").getByTestId("tag-input-chip-remove").click();
  await page.getByTestId("template-admin-tags").fill("reviewed-template");
  await page.getByTestId("template-admin-tags").press("Enter");
  await page.getByTestId("template-admin-save-tags").click();
  await expect.poll(async () => (await apiGet<Template>(request, `/api/templates/${template.id}`)).tags).toEqual(["reviewed-template"]);
  await page.getByTestId("template-admin-visibility").click();
  await expect.poll(async () => (await apiGet<Template>(request, `/api/templates/${template.id}`)).isPublic).toBe(false);
  await page.getByTestId("template-admin-edit").click();
  await page.getByTestId("template-name").fill("Administrator edited template");
  await page.getByTestId("template-update").click();
  await expect(page.getByTestId("template-status")).toHaveAttribute("data-dirty", "false");
  expect((await apiGet<Template>(request, `/api/templates/${template.id}`)).owner.id).toBe(owner.id);
  await page.goto(`/create?template=${template.id}`);
  await page.getByTestId("template-admin-review").click();
  await expect(page.getByTestId("template-dependent-post")).toHaveCount(3);
  await expect(page.getByTestId("template-admin-delete")).toBeDisabled();
  for (const meme of [direct, child, hidden]) {
    await expect(page.locator(`[data-testid="template-dependent-post"][data-meme-id="${meme.id}"]`)).toBeVisible();
  }
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByTestId("template-dependents-delete-all").click();
  expect((await request.get(`/api/memes/${direct.id}`)).status()).toBe(200);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.locator(`[data-testid="template-dependent-post"][data-meme-id="${direct.id}"]`).getByTestId("template-dependent-delete").click();
  await expect(page.getByTestId("template-dependent-post")).toHaveCount(2);
  expect((await request.get(`/api/memes/${direct.id}`)).status()).toBe(404);
  await page.getByTestId("template-dependents-delete-all").click();
  await expect(page.getByTestId("template-dependent-post")).toHaveCount(0);
  await expect(page.getByTestId("template-admin-delete")).toBeEnabled();
  for (const meme of [child, hidden]) expect((await request.get(`/api/memes/${meme.id}`)).status()).toBe(404);
  expect((await request.get(`/api/memes/${unrelated.id}`)).status()).toBe(200);
  await page.getByTestId("template-admin-delete").click();
  await expect.poll(async () => (await request.get(`/api/templates/${template.id}`)).status()).toBe(404);
  expect((await request.get(`/api/templates/${variation.id}`)).status()).toBe(404);
  expect((await request.get(`/storage${template.asset.contentPath}`)).status()).toBe(200);
});
