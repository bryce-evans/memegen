import { createSql } from "@memegen/server-kit";
import type { Comment } from "@memegen/shared";
import { E2E_ENV } from "./environment.ts";
import { apiMeme, apiPost, apiUser, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("admin browses, confirms exact deletion target, and reads retained immutable history", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("audit-owner"));
  const moderator = await apiUser(request, scoped("audit-admin"));
  const meme = await apiMeme(request, owner, { title: "Audit deletion target" });
  const comment = await apiPost<Comment>(request, `/api/memes/${meme.id}/comments`, owner, { body: "Dependent comment is audited too" });
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try { await sql`update users set is_admin = true where id = ${moderator.id}`; } finally { await sql.end(); }
  await page.goto("/admin");
  await signIn(page, moderator.username);
  await expect(page.getByTestId("admin-page")).toBeVisible();
  await page.getByTestId("admin-search").fill(meme.id);
  await page.getByTestId("admin-filter").click();
  const target = page.locator(`[data-testid="admin-resource"][data-resource-id="${meme.id}"]`);
  await target.getByTestId("admin-select-delete").click();
  await expect(page.getByTestId("admin-delete-review")).toContainText(meme.title);
  await page.getByTestId("admin-confirm-id").fill(owner.id);
  await expect(page.getByTestId("admin-confirm-delete")).toBeDisabled();
  await page.getByTestId("admin-confirm-id").fill(meme.id);
  await page.getByTestId("admin-confirm-delete").click();
  await expect(page.getByTestId("admin-delete-success")).toContainText(meme.title);
  await expect(target).toHaveCount(0);
  expect((await request.get(`/api/memes/${meme.id}`)).status()).toBe(404);
  await page.getByTestId("admin-audit-tab").click();
  await page.getByTestId("admin-audit-search").fill(meme.id);
  await page.getByTestId("admin-audit-filter").click();
  const entry = page.locator(`[data-testid="admin-audit-entry"][data-target-id="${meme.id}"]`);
  await expect(entry).toContainText(moderator.username);
  await expect(entry).toContainText(meme.title);
  await expect(entry.getByRole("button")).toHaveCount(0);
  await page.getByTestId("admin-audit-search").fill(comment.id);
  await page.getByTestId("admin-audit-filter").click();
  await expect(page.locator(`[data-testid="admin-audit-entry"][data-target-id="${comment.id}"]`)).toContainText("Dependent comment is audited too");
});

test("admin account blockers are actionable and owner-filtered resource browse paginates", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("blocked-audit-owner"));
  const moderator = await apiUser(request, scoped("blocked-audit-admin"));
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try {
    await sql`update users set is_admin = true where id = ${moderator.id}`;
    await sql`insert into tags ${sql(Array.from({ length: 27 }, (_, i) => ({
      name: `Audit pagination ${i}`, slug: `audit-${owner.id.slice(0, 8)}-${i}`, created_by: owner.id,
    })))}`;
  } finally { await sql.end(); }
  await page.goto("/admin");
  await signIn(page, moderator.username);
  await page.getByTestId("admin-kind").selectOption("users");
  await page.getByTestId("admin-search").fill(owner.id);
  await page.getByTestId("admin-filter").click();
  const account = page.locator(`[data-testid="admin-resource"][data-resource-id="${owner.id}"]`);
  await account.getByTestId("admin-select-delete").click();
  await page.getByTestId("admin-confirm-id").fill(owner.id);
  await page.getByTestId("admin-confirm-delete").click();
  await expect(page.getByTestId("admin-delete-error")).toContainText("27 tags");
  await expect(page.getByTestId("admin-delete-error")).toContainText("No content was deleted");
  await expect(page.getByTestId("admin-delete-success")).toHaveCount(0);
  await account.getByTestId("admin-filter-owner").click();
  await page.getByTestId("admin-kind").selectOption("tags");
  await expect(page.getByTestId("admin-owner-filter")).toHaveValue(owner.id);
  await expect(page.getByTestId("admin-resource")).toHaveCount(25);
  await page.getByTestId("admin-more").click();
  await expect(page.getByTestId("admin-resource")).toHaveCount(27);
  await expect(page.getByTestId("admin-more")).toHaveCount(0);
});

test("nonadmin direct management navigation has no resource or audit access", async ({ page, request }) => {
  const ordinary = await apiUser(request, scoped("audit-ordinary"));
  await page.goto("/admin");
  await signIn(page, ordinary.username);
  await expect(page.getByTestId("admin-page")).toHaveCount(0);
  await expect(page.getByText("Administrator access required.", { exact: true })).toBeVisible();
  expect((await request.get("/api/admin/audit", { headers: { "x-user-id": ordinary.id } })).status()).toBe(403);
});
