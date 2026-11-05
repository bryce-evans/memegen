import { createSql } from "@memegen/server-kit";
import type { AdminAuditEntry, Comment, Page } from "@memegen/shared";
import { E2E_ENV } from "./environment.ts";
import { apiGet, apiMeme, apiPost, apiUser, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("per-meme administration records the deleted post and dependent comments in the audit API", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("audit-owner"));
  const moderator = await apiUser(request, scoped("audit-admin"));
  const meme = await apiMeme(request, owner, { title: "Audit deletion target" });
  const comment = await apiPost<Comment>(request, `/api/memes/${meme.id}/comments`, owner, { body: "Dependent comment is audited too" });
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try { await sql`update users set is_admin = true where id = ${moderator.id}`; } finally { await sql.end(); }
  await page.goto(`/m/${meme.id}`);
  await signIn(page, moderator.username);
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByTestId("admin-delete-meme").click();
  expect((await request.get(`/api/memes/${meme.id}`)).status()).toBe(200);
  expect((await apiGet<Page<AdminAuditEntry>>(request, `/api/admin/audit?search=${meme.id}`, moderator)).items).toEqual([]);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("admin-delete-meme").click();
  await expect.poll(async () => (await request.get(`/api/memes/${meme.id}`)).status()).toBe(404);
  for (const target of [
    { id: meme.id, kind: "memes", label: meme.title, snapshot: { ownerId: owner.id } },
    { id: comment.id, kind: "comments", label: comment.body, snapshot: { ownerId: owner.id, memeId: meme.id } },
  ]) {
    const history = await apiGet<Page<AdminAuditEntry>>(request, `/api/admin/audit?kind=${target.kind}&search=${target.id}`, moderator);
    expect(history.items).toEqual([expect.objectContaining({
      actorId: moderator.id,
      actorName: moderator.username,
      action: "delete",
      targetKind: target.kind,
      targetId: target.id,
      label: target.label,
      snapshot: expect.objectContaining(target.snapshot),
    })]);
  }
  expect((await request.get("/api/admin/audit", { headers: { "x-user-id": owner.id } })).status()).toBe(403);
});
