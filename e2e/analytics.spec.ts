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
  await page.getByTestId("profile-tab-admin").click();
  await expect(page).toHaveURL(new RegExp(`/u/${admin.username}\\?tab=admin$`));
  await expect(page.getByTestId("analytics-panel")).toHaveAttribute("aria-busy", "false");
  const chart = page.getByTestId("analytics-chart");
  await expect(chart.getByTestId("line-chart-plot")).toHaveCount(5);
  const historicalPost = chart.locator(`[data-series="posts"] [data-date="${historicalDate}"]`);
  await expect(historicalPost).toHaveAttribute("data-value", "2");
  await expect(chart.locator(`[data-series="templates"] [data-date="${historicalDate}"]`)).toHaveAttribute("data-value", "2");
  await expect(chart.locator(`[data-series="newUsers"] [data-date="${historicalDate}"]`)).toHaveAttribute("data-value", "1");
  await expect(chart.locator(`[data-series="comments"] [data-date="${historicalDate}"]`)).toHaveAttribute("data-value", "1");
  const analytics = await apiGet<AdminAnalytics>(request, "/api/admin/analytics?days=30", admin);
  expect(historicalDate < analytics.loginTrackingStartedAt.slice(0, 10)).toBe(true);
  await expect(chart.locator(`[data-series="uniqueLogins"] [data-date="${historicalDate}"]`)).toHaveCount(0);
  await chart.getByTestId("line-chart-values").click();
  const historicalDetails = chart.locator(`.ui-line-chart-data > [data-date="${historicalDate}"]`);
  await expect(historicalDetails.locator('[data-series="uniqueLogins"]')).toHaveText("Not tracked");
  await expect(historicalDetails.locator('[data-series="posts"]')).toHaveText("2");
  const today = analytics.daily.find((day) => day.date === analytics.to)!;
  await expect(chart.locator(`[data-series="uniqueLogins"] [data-date="${analytics.to}"]`)).toHaveAttribute("data-value", String(today.uniqueLogins));
  for (const days of [7, 90, 30]) {
    await page.getByTestId(`analytics-range-${days}`).click();
    const expected = await apiGet<AdminAnalytics>(request, `/api/admin/analytics?days=${days}`, admin);
    await expect(page.getByTestId("analytics-date-range")).toContainText(`${expected.from} – ${expected.to}`);
    const posts = chart.locator('[data-series="posts"] [data-date]');
    await expect(posts).toHaveCount(days);
    await expect(posts.first()).toHaveAttribute("data-date", expected.from);
    await expect(posts.last()).toHaveAttribute("data-date", expected.to);
    if (days === 7) await expect(historicalPost).toHaveCount(0);
    else await expect(historicalPost).toHaveAttribute("data-value", "2");
  }
  await expect(page.getByTestId("analytics-total-users")).toHaveText(String(before.totals.users));
  await expect(page.getByTestId("analytics-total-posts")).toHaveText(String(before.totals.posts + 2));
  await expect(page.getByTestId("analytics-total-templates")).toHaveText(String(before.totals.templates + 2));
  await expect(page.getByTestId("analytics-total-drafts")).toHaveText(String(before.totals.drafts + 1));
  await expect(page.getByTestId("analytics-total-comments")).toHaveText(String(before.totals.comments + 1));
  const totals = await apiGet<AdminAnalytics>(request, "/api/admin/analytics", admin);
  expect(totals.totals.storageBytes).toBeGreaterThan(before.totals.storageBytes);
  await expect(page.getByTestId("analytics-total-storageBytes")).toHaveAttribute("title", `${totals.totals.storageBytes.toLocaleString()} bytes`);
  await expect(page.getByTestId("analytics-total-storageBytes")).toHaveText(/^[\d.]+ (KB|MB|GB)$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("analytics-range-90")).toBeVisible();
  await page.getByTestId("account-button").click();
  await expect(page.getByTestId("nav-profile")).toBeVisible();
  await page.getByTestId("nav-profile").click();
  await page.getByTestId("profile-tab-admin").click();
  await expect(page.getByTestId("analytics-panel")).toHaveAttribute("aria-busy", "false");
  for (const plot of await chart.getByTestId("line-chart-plot").all()) {
    const bounds = await plot.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(200);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await chart.getByTestId("line-chart-values").click();
  await expect(historicalDetails.locator('[data-series="posts"]')).toHaveText("2");
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
    await expect(page.getByTestId("analytics-chart")).toHaveCount(0);
    await sql`update users set is_admin = true where id = ${admin.id}`;
    await page.getByTestId("analytics-retry").click();
    await expect(page.getByTestId("analytics-chart").getByTestId("line-chart-plot")).toHaveCount(5);
    await expect(page.getByTestId("analytics-error")).toHaveCount(0);
    await expect(page.getByTestId("analytics-panel")).toHaveAttribute("aria-busy", "false");
  } finally {
    releaseRequest();
    await sql.end();
  }
});

test("admin analytics is limited to the admin's own profile and old analytics links fall back", async ({ page, request }) => {
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

test("zero activity remains plotted across a UTC year boundary with readable storage units", async ({ page, request }) => {
  const admin = await apiUser(request, scoped("analytics-zero-admin"));
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try { await sql`update users set is_admin = true where id = ${admin.id}`; } finally { await sql.end(); }
  await page.goto(`/u/${admin.username}`);
  await signIn(page, admin.username);
  await page.route("**/api/admin/analytics?days=*", async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get("days"));
    const daily = Array.from({ length: days }, (_, index) => ({
      date: new Date(Date.UTC(2027, 0, 1 - days + 1 + index)).toISOString().slice(0, 10),
      uniqueLogins: 0, posts: 0, templates: 0, newUsers: 0, comments: 0,
    }));
    const payload: AdminAnalytics = {
      timezone: "UTC", from: daily[0]!.date, to: daily[daily.length - 1]!.date,
      loginTrackingStartedAt: "2026-01-01T00:00:00.000Z",
      totals: { users: 0, posts: 0, templates: 0, drafts: 0, comments: 0, storageBytes: days === 30 ? 1.5 * 1024 ** 3 : days === 7 ? 512 * 1024 : 2.5 * 1024 ** 2 },
      daily,
    };
    await route.fulfill({ json: payload });
  });
  await page.getByTestId("profile-tab-admin").click();
  const chart = page.getByTestId("analytics-chart");
  await expect(page.getByTestId("analytics-total-storageBytes")).toHaveText("1.5 GB");
  await page.getByTestId("analytics-range-7").click();
  await expect(page.getByTestId("analytics-date-range")).toContainText("2026-12-26 – 2027-01-01");
  await expect(page.getByTestId("analytics-total-storageBytes")).toHaveText("512.0 KB");
  for (const key of ["uniqueLogins", "posts", "templates", "newUsers", "comments"]) {
    const series = chart.locator(`.ui-line-chart-series [data-series="${key}"]`);
    await expect(series.getByTestId("line-chart-plot")).toBeVisible();
    await expect(series.locator('[data-value="0"]')).toHaveCount(7);
    const line = series.locator(".ui-line-chart-line");
    const geometry = await line.evaluate((element) => {
      const bounds = (element as SVGGraphicsElement).getBBox();
      return { width: bounds.width, height: bounds.height };
    });
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.height).toBe(0);
  }
  await chart.getByTestId("line-chart-values").click();
  const details = chart.locator('.ui-line-chart-data > [data-date="2027-01-01"]');
  await expect(details.locator("dd")).toHaveText(["0", "0", "0", "0", "0"]);
  await page.getByTestId("analytics-range-90").click();
  await expect(page.getByTestId("analytics-total-storageBytes")).toHaveText("2.5 MB");
});
