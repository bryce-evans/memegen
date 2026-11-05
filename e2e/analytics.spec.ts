import { createSql } from "@memegen/server-kit";
import type { AdminAnalytics, Comment } from "@memegen/shared";
import { E2E_ENV } from "./environment.ts";
import { apiGet, apiMeme, apiPost, apiTemplate, apiUser, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("admin analytics reports retained content and switches UTC ranges", async ({ page, request }) => {
  const admin = await apiUser(request, scoped("analytics-admin"));
  const owner = await apiUser(request, scoped("analytics-owner"));
  const roleSql = createSql(E2E_ENV.DATABASE_URL);
  try { await roleSql`update users set is_admin = true where id = ${admin.id}`; } finally { await roleSql.end(); }
  const before = await apiGet<AdminAnalytics>(request, "/api/admin/analytics", admin);
  const template = await apiTemplate(request, owner, { name: scoped("Analytics base") });
  const variation = await apiTemplate(request, owner, { name: scoped("Analytics variation"), parentId: template.id, isPublic: false });
  const posted = await apiMeme(request, owner, { title: "Analytics public", templateId: template.id });
  const unlisted = await apiMeme(request, owner, { title: "Analytics unlisted", templateId: template.id, visibility: "unlisted" });
  const draft = await apiMeme(request, owner, { title: "Analytics draft", templateId: template.id, post: false });
  const comment = await apiPost<Comment>(request, `/api/memes/${posted.id}/comments`, owner, { body: "Analytics retained comment" });
  const historical = new Date();
  historical.setUTCDate(historical.getUTCDate() - 17);
  const historicalDate = historical.toISOString().slice(0, 10);
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try {
    await sql`update users set created_at = ${historical} where id = ${owner.id}`;
    await sql`update templates set created_at = ${historical} where id in (${template.id}, ${variation.id})`;
    await sql`update memes set created_at = ${historical}, posted_at = ${historical} where id in (${posted.id}, ${unlisted.id})`;
    await sql`update memes set created_at = ${historical} where id = ${draft.id}`;
    await sql`update comments set created_at = ${historical} where id = ${comment.id}`;
  } finally { await sql.end(); }

  await page.goto(`/u/${admin.username}`);
  await signIn(page, admin.username);
  await expect(page.locator('[data-testid="profile-tab-ai"] + [data-testid="profile-tab-admin"]')).toBeVisible();
  await expect(page.getByTestId("nav-admin")).toHaveCount(0);
  await page.getByTestId("profile-tab-admin").click();
  await expect(page).toHaveURL(new RegExp(`/u/${admin.username}\\?tab=admin$`));
  await expect(page.getByTestId("analytics-panel")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("analytics-day")).toHaveCount(30);
  const historicalRow = page.locator(`[data-testid="analytics-day"][data-date="${historicalDate}"]`);
  await expect(historicalRow.getByTestId("analytics-day-posts")).toHaveText("2");
  await expect(historicalRow.getByTestId("analytics-day-templates")).toHaveText("2");
  await expect(historicalRow.getByTestId("analytics-day-users")).toHaveText("1");
  await expect(historicalRow.getByTestId("analytics-day-comments")).toHaveText("1");
  const analytics = await apiGet<AdminAnalytics>(request, "/api/admin/analytics?days=30", admin);
  expect(historicalDate < analytics.loginTrackingStartedAt.slice(0, 10)).toBe(true);
  await expect(historicalRow.getByTestId("analytics-day-logins")).toHaveText("—");
  await expect(historicalRow.getByTestId("analytics-day-logins")).toHaveAttribute("aria-label", "Not tracked");
  await expect(page.getByTestId("analytics-tracking-note")).toContainText(analytics.loginTrackingStartedAt);
  const today = analytics.daily.find((day) => day.date === analytics.to)!;
  await expect(page.locator(`[data-testid="analytics-day"][data-date="${analytics.to}"]`).getByTestId("analytics-day-logins")).toHaveText(String(today.uniqueLogins));
  await page.getByTestId("analytics-range-7").click();
  await expect(page.getByTestId("analytics-day")).toHaveCount(7);
  await expect(historicalRow).toHaveCount(0);
  await page.getByTestId("analytics-range-90").click();
  await expect(page.getByTestId("analytics-day")).toHaveCount(90);
  await expect(historicalRow.getByTestId("analytics-day-posts")).toHaveText("2");
  await expect(page.getByTestId("analytics-total-users")).toHaveText(String(before.totals.users));
  await expect(page.getByTestId("analytics-total-posts")).toHaveText(String(before.totals.posts + 2));
  await expect(page.getByTestId("analytics-total-templates")).toHaveText(String(before.totals.templates + 2));
  await expect(page.getByTestId("analytics-total-drafts")).toHaveText(String(before.totals.drafts + 1));
  await expect(page.getByTestId("analytics-total-comments")).toHaveText(String(before.totals.comments + 1));
  expect(Number(await page.getByTestId("analytics-total-storageBytes").textContent())).toBeGreaterThan(before.totals.storageBytes);
  const firstRow = page.getByTestId("analytics-day").first();
  await expect(firstRow.getByTestId("analytics-day-posts")).toHaveText("0");
  await expect(firstRow.getByTestId("analytics-day-templates")).toHaveText("0");
  await page.getByTestId("analytics-range-30").click();
  await expect(page.getByTestId("analytics-day")).toHaveCount(30);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("analytics-range-90")).toBeVisible();
  await page.getByTestId("account-button").click();
  await expect(page.getByTestId("nav-profile")).toBeVisible();
  await expect(page.getByTestId("nav-admin")).toHaveCount(0);
  await page.getByTestId("nav-profile").click();
  await page.getByTestId("profile-tab-admin").click();
  await expect(page.getByTestId("analytics-panel")).toHaveAttribute("aria-busy", "false");
  expect(await page.getByTestId("analytics-table-scroll").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("analytics shows loading and recovers from a real authorization error", async ({ page, request }) => {
  const admin = await apiUser(request, scoped("analytics-retry-admin"));
  const sql = createSql(E2E_ENV.DATABASE_URL);
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  try {
    await sql`update users set is_admin = true where id = ${admin.id}`;
    await page.goto(`/u/${admin.username}`);
    await signIn(page, admin.username);
    await sql`update users set is_admin = false where id = ${admin.id}`;
    await page.route("**/api/admin/analytics?days=30", async (route) => {
      await requestGate;
      await route.continue();
    });
    await page.getByTestId("profile-tab-admin").click();
    await expect(page.getByTestId("analytics-loading")).toBeVisible();
    await expect(page.getByTestId("analytics-panel")).toHaveAttribute("aria-busy", "true");
    const forbidden = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/analytics" && response.status() === 403);
    releaseRequest();
    await forbidden;
    await expect(page.getByTestId("analytics-error")).toBeVisible();
    await expect(page.getByTestId("analytics-daily")).toHaveCount(0);
    await sql`update users set is_admin = true where id = ${admin.id}`;
    await page.getByTestId("analytics-retry").click();
    await expect(page.getByTestId("analytics-day")).toHaveCount(30);
    await expect(page.getByTestId("analytics-error")).toHaveCount(0);
    await expect(page.getByTestId("analytics-panel")).toHaveAttribute("aria-busy", "false");
  } finally {
    releaseRequest();
    await sql.end();
  }
});

test("administration is limited to the admin's own profile and old analytics links fall back", async ({ page, request }) => {
  const admin = await apiUser(request, scoped("analytics-access-admin"));
  const ordinary = await apiUser(request, scoped("analytics-access-user"));
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try { await sql`update users set is_admin = true where id = ${admin.id}`; } finally { await sql.end(); }
  let analyticsRequests = 0;
  page.on("request", (req) => { if (new URL(req.url()).pathname === "/api/admin/analytics") analyticsRequests++; });
  await page.goto(`/u/${ordinary.username}?tab=admin`);
  await signIn(page, admin.username);
  await expect(page.getByTestId("profile-overview")).toBeVisible();
  await expect(page.getByTestId("profile-tab-admin")).toHaveCount(0);
  await expect(page.getByTestId("analytics-panel")).toHaveCount(0);
  await page.goto(`/u/${admin.username}?tab=analytics`);
  await expect(page.getByTestId("profile-overview")).toBeVisible();
  await expect(page.getByTestId("analytics-panel")).toHaveCount(0);
  await page.getByTestId("sign-out").click();
  await signIn(page, ordinary.username);
  await page.goto(`/u/${ordinary.username}?tab=admin`);
  await expect(page.getByTestId("profile-overview")).toBeVisible();
  await expect(page.getByTestId("profile-tab-admin")).toHaveCount(0);
  await expect(page.getByTestId("analytics-panel")).toHaveCount(0);
  await page.goto(`/u/${admin.username}?tab=admin`);
  await expect(page.getByTestId("profile-overview")).toBeVisible();
  await expect(page.getByTestId("profile-tab-admin")).toHaveCount(0);
  expect(analyticsRequests).toBe(0);
  expect((await request.get("/api/admin/analytics", { headers: { "x-user-id": ordinary.id } })).status()).toBe(403);
});
