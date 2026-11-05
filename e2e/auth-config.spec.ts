import { createSql } from "@memegen/server-kit";
import { E2E_ENV } from "./environment.ts";
import { apiUser, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("authentication waits for runtime configuration; a failed lookup offers retry instead of dev login", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let fail = true;
  await page.route("**/api/auth/config", async (route) => {
    if (!fail) return route.continue();
    await pending;
    await route.fulfill({ status: 503, json: { error: "Authentication service unavailable" } });
  });
  await page.goto("/leaderboard");
  await expect(page.getByTestId("auth-loading")).toBeVisible();
  await expect(page.getByTestId("login-username")).toHaveCount(0);
  await expect(page.getByTestId("sso-sign-in")).toHaveCount(0);
  release();
  await expect(page.getByTestId("auth-error")).toContainText("Authentication service unavailable");
  await expect(page.getByTestId("login-username")).toHaveCount(0);
  await expect(page.getByTestId("sso-sign-in")).toHaveCount(0);
  fail = false;
  await page.getByTestId("auth-retry").click();
  await signIn(page, scoped("auth-retry-user"));
  await expect(page).toHaveURL(/\/leaderboard$/);
});

test("OIDC chosen at runtime ignores a persisted dev identity and sends the deep route to server login", async ({ page, request, baseURL }) => {
  const user = await apiUser(request, scoped("auth-old-dev-identity"));
  await page.context().addCookies([{ name: "memegen.user", value: encodeURIComponent(JSON.stringify(user)), url: baseURL! }]);
  await page.route("**/api/auth/config", (route) => route.fulfill({ json: { mode: "oidc", loginUrl: "/api/auth/login" } }));
  // The real dev server returns an anonymous session: the old dev cookie must not authenticate this request.
  const sessionRequest = page.waitForRequest("**/api/auth/session");
  const returnTo = "/create?template=deep-link&returnTo=https%3A%2F%2Fevil.example#captions";
  await page.goto(returnTo);
  await expect(page.getByTestId("sso-sign-in")).toBeVisible();
  await expect(page.getByTestId("login-username")).toHaveCount(0);
  await expect(page.getByTestId("current-user")).toHaveCount(0);
  expect((await sessionRequest).headers()["x-user-id"]).toBeUndefined();
  expect((await page.context().cookies()).find((cookie) => cookie.name === "memegen.user")).toBeUndefined();
  // Stop at the server handoff; the real OIDC protocol is covered by the backend's issuer fixture.
  await page.route("**/api/auth/login?*", (route) => route.fulfill({ status: 204 }));
  const loginRequest = page.waitForRequest("**/api/auth/login?*");
  await page.getByTestId("sso-sign-in").click();
  const loginUrl = new URL((await loginRequest).url());
  expect(loginUrl.origin).toBe(new URL(baseURL!).origin);
  expect(loginUrl.searchParams.get("returnTo")).toBe(returnTo);
});

test("invalid runtime authentication configuration fails closed", async ({ page }) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({
    json: { mode: "oidc", loginUrl: "https://evil.example/login" },
  }));
  await page.goto("/recent");
  await expect(page.getByTestId("auth-error")).toContainText("invalid authentication configuration");
  await expect(page.getByTestId("auth-retry")).toBeVisible();
  await expect(page.getByTestId("login-username")).toHaveCount(0);
  await expect(page.getByTestId("sso-sign-in")).toHaveCount(0);
});

test("OIDC handoff rejects an encoded network-path return route", async ({ page }) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({ json: { mode: "oidc", loginUrl: "/api/auth/login" } }));
  await page.goto("/%2Fevil.example");
  await expect(page.getByTestId("sso-sign-in")).toBeVisible();
  await page.route("**/api/auth/login?*", (route) => route.fulfill({ status: 204 }));
  const loginRequest = page.waitForRequest("**/api/auth/login?*");
  await page.getByTestId("sso-sign-in").click();
  expect(new URL((await loginRequest).url()).searchParams.get("returnTo")).toBe("/");
});

test("failed server logout keeps the account signed in until a successful retry", async ({ page }) => {
  const username = scoped("auth-logout-retry");
  await page.goto("/leaderboard");
  await signIn(page, username);
  await page.context().setOffline(true);
  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("sign-out-error")).toBeVisible();
  await expect(page.getByTestId("current-user")).toHaveText(username);
  expect((await page.context().cookies()).some((cookie) => cookie.name === "memegen.user")).toBe(true);
  await page.context().setOffline(false);
  const revoked = page.waitForResponse((response) => response.url().endsWith("/api/session") && response.request().method() === "DELETE");
  await page.getByTestId("sign-out").click();
  expect((await revoked).status()).toBe(204);
  await expect(page.getByTestId("login-username")).toBeVisible();
  expect((await page.context().cookies()).some((cookie) => cookie.name === "memegen.user")).toBe(false);
  await page.reload();
  await expect(page.getByTestId("login-username")).toBeVisible();
});

test("a session rejected on focus returns to sign-in without losing the current route", async ({ page, request }) => {
  const user = await apiUser(request, scoped("auth-expired-account"));
  await page.goto("/leaderboard");
  await signIn(page, user.username);
  const sql = createSql(E2E_ENV.DATABASE_URL);
  try {
    await sql`delete from users where id = ${user.id}`;
  } finally {
    await sql.end();
  }
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("login-username")).toBeVisible();
  await expect(page.getByTestId("current-user")).toHaveCount(0);
  await expect(page).toHaveURL(/\/leaderboard$/);
  await signIn(page, scoped("auth-after-expiry"));
  await expect(page).toHaveURL(/\/leaderboard$/);
});
