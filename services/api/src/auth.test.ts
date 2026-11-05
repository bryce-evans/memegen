import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LIMITS, type AuthSession } from "@memegen/shared";
import type { Hono } from "hono";
import { authConfigFromEnv, config, createAuthProvider, type Env, type Sql } from "@memegen/server-kit";
import { freshTestDb } from "@memegen/server-kit/testing";
import { startOidcFixture, type OidcFixture } from "@memegen/server-kit/oidc-fixture";
import { AssetStore, LocalStorageProvider, staticProviders } from "@memegen/storage";
import { createStorageApp } from "../../storage/src/app.ts";
import { createApiApp, type ApiApp } from "./app.ts";

let sql: Sql;
let fixture: OidcFixture;
let api: ApiApp;
let storage: Hono<Env>;
let dir: string;
const origin = "http://127.0.0.1:37999";

before(async () => {
  sql = await freshTestDb();
  fixture = await startOidcFixture();
  const provider = await createAuthProvider(sql, authConfigFromEnv({
    MODE: "dev", AUTH_MODE: "oidc", PUBLIC_ORIGIN: origin,
    OIDC_ISSUER_URL: fixture.issuer, OIDC_CLIENT_ID: fixture.clientId, OIDC_CLIENT_SECRET: fixture.clientSecret,
  }));
  api = createApiApp(sql, provider);
  dir = await mkdtemp(join(tmpdir(), "memegen-oidc-"));
  storage = createStorageApp(new AssetStore(sql, staticProviders(new LocalStorageProvider(dir)), DEFAULT_LIMITS), provider);
});
after(async () => {
  await fixture?.close();
  await sql?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function beginLogin(returnTo = "/templates?q=cats") {
  const response = await api.request(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  assert.equal(response.status, 302);
  const cookie = response.headers.getSetCookie()[0]!.split(";")[0]!;
  const authorization = new URL(response.headers.get("location")!);
  const redirect = await fetch(authorization, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  const callback = new URL(redirect.headers.get("location")!);
  return { cookie, callback, state: authorization.searchParams.get("state")! };
}

async function login() {
  const transaction = await beginLogin();
  const response = await api.request(transaction.callback, { headers: { cookie: transaction.cookie } });
  assert.equal(response.status, 302, await response.clone().text());
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("memegen_dev_session="))!;
  const cookie = setCookie.split(";")[0]!;
  const sessionResponse = await api.request("/api/auth/session", { headers: { cookie } });
  const session = await sessionResponse.json() as AuthSession;
  assert.ok(session.user);
  return { cookie, user: session.user, response, transaction, setCookie };
}

test("signed authorization-code PKCE flow creates a safe identity, ignores colliding profile names, and stores only a token hash", async () => {
  const [admin] = await sql<{ id: string }[]>`insert into users (username, is_admin) values ('alice', true) returning id`;
  const result = await login();
  assert.notEqual(result.user.id, admin!.id);
  assert.match(result.user.username, /^member_[a-f0-9]{24}$/);
  assert.equal(result.user.isAdmin, false);
  assert.equal(result.response.headers.get("location"), "/templates?q=cats");
  assert.match(result.setCookie, /HttpOnly/);
  assert.match(result.setCookie, /SameSite=Lax/);
  assert.match(result.setCookie, /Path=\//);
  const token = result.cookie.split("=")[1]!;
  const [session] = await sql<{ token_hash: string; user_id: string }[]>`select token_hash, user_id from auth_sessions where user_id = ${result.user.id}`;
  assert.equal(session!.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.notEqual(session!.token_hash, token);
  assert.equal((await login()).user.id, result.user.id);
  fixture.controls.subject = "different-subject";
  assert.notEqual((await login()).user.id, result.user.id);
  fixture.controls.subject = "fixture-user";
});

test("OIDC never accepts dev username login or forged user/role headers", async () => {
  const [admin] = await sql<{ id: string }[]>`select id from users where username = 'alice'`;
  const headers = { "x-user-id": admin!.id, "x-user-role": "admin", "x-is-admin": "true" };
  const response = await api.request("/api/auth/session", { headers });
  assert.deepEqual(await response.json(), { user: null });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await api.request("/api/me", { headers })).status, 401);
  assert.equal((await api.request("/api/session", { method: "POST", headers: { ...headers, origin, "content-type": "application/json" }, body: '{"username":"alice"}' })).status, 404);
  const signedIn = await login();
  const own = await api.request("/api/auth/session", { headers: { ...headers, cookie: signedIn.cookie } });
  assert.equal(((await own.json()) as AuthSession).user!.id, signedIn.user.id);
  const configuration = await api.request("/api/auth/config");
  assert.deepEqual(await configuration.json(), { mode: "oidc", loginUrl: "/api/auth/login" });
  assert.equal(configuration.headers.get("cache-control"), "no-store");
});

test("invalid, expired, and revoked opaque sessions are anonymous; current database roles are authoritative", async () => {
  for (const cookie of ["memegen_dev_session=invalid", `memegen_dev_session=${randomBytes(32).toString("base64url")}`]) {
    assert.deepEqual(await (await api.request("/api/auth/session", { headers: { cookie } })).json(), { user: null });
  }
  const current = await login();
  await sql`update users set is_admin = true where id = ${current.user.id}`;
  assert.equal(((await (await api.request("/api/auth/session", { headers: { cookie: current.cookie } })).json()) as AuthSession).user!.isAdmin, true);
  await sql`update users set is_admin = false where id = ${current.user.id}`;
  await sql`update auth_sessions set expires_at = now() - interval '1 second' where user_id = ${current.user.id}`;
  assert.deepEqual(await (await api.request("/api/auth/session", { headers: { cookie: current.cookie } })).json(), { user: null });
  const renewed = await login();
  const logout = await api.request("/api/session", { method: "DELETE", headers: { cookie: renewed.cookie, origin } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
  assert.deepEqual(await (await api.request("/api/auth/session", { headers: { cookie: renewed.cookie } })).json(), { user: null });
});

test("API and storage state changes require exact Origin; internal bearer access retains its independent authorization", async () => {
  const { cookie } = await login();
  for (const badOrigin of [undefined, "null", "https://evil.test", `${origin}.evil.test`, `${origin}/`]) {
    const headers: Record<string, string> = { cookie };
    if (badOrigin !== undefined) headers.origin = badOrigin;
    assert.equal((await api.request("/api/session", { method: "DELETE", headers })).status, 403);
    assert.equal((await storage.request("/assets", { method: "POST", headers })).status, 403);
  }
  const allowed = await storage.request("/assets", { method: "POST", headers: { cookie, origin } });
  assert.equal(allowed.status, 400); // Passed origin enforcement and reached multipart validation.
  if (config.internalToken) {
    const internal = await storage.request("/assets/00000000-0000-4000-8000-000000000000", {
      method: "DELETE", headers: { "x-internal-token": config.internalToken },
    });
    assert.equal(internal.status, 404); // The intended internal route remains reachable without browser Origin.
  }
});

test("callbacks are browser-bound, expire, and cannot be replayed", async () => {
  const transaction = await beginLogin();
  assert.equal((await api.request(transaction.callback)).status, 400);
  assert.equal((await api.request(transaction.callback, { headers: { cookie: `memegen_dev_login=${randomBytes(32).toString("base64url")}` } })).status, 400);
  const tampered = new URL(transaction.callback);
  tampered.searchParams.set("state", randomBytes(32).toString("base64url"));
  assert.equal((await api.request(tampered, { headers: { cookie: transaction.cookie } })).status, 400);
  assert.equal((await api.request(transaction.callback, { headers: { cookie: transaction.cookie } })).status, 302);
  assert.equal((await api.request(transaction.callback, { headers: { cookie: transaction.cookie } })).status, 400);
  const expired = await beginLogin();
  await sql`update auth_login_transactions set expires_at = now() - interval '1 second'`;
  assert.equal((await api.request(expired.callback, { headers: { cookie: expired.cookie } })).status, 400);
});

test("nonce, ID token expiry, and signatures are checked and failed callbacks are single-use", async () => {
  for (const fault of ["nonce", "expired", "invalidSignature"] as const) {
    const transaction = await beginLogin();
    if (fault === "nonce") fixture.controls.nonce = "wrong-nonce";
    else fixture.controls[fault] = true;
    const response = await api.request(transaction.callback, { headers: { cookie: transaction.cookie } });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "OIDC login could not be verified" });
    fixture.controls.nonce = null;
    fixture.controls.expired = false;
    fixture.controls.invalidSignature = false;
    assert.equal((await api.request(transaction.callback, { headers: { cookie: transaction.cookie } })).status, 400);
  }
});

test("HTTPS public origins use host-only Secure cookies for login and sessions", async () => {
  const secureOrigin = "https://127.0.0.1:37999";
  const provider = await createAuthProvider(sql, authConfigFromEnv({
    MODE: "dev", AUTH_MODE: "oidc", PUBLIC_ORIGIN: secureOrigin,
    OIDC_ISSUER_URL: fixture.issuer, OIDC_CLIENT_ID: fixture.clientId, OIDC_CLIENT_SECRET: fixture.clientSecret,
  }));
  const secureApi = createApiApp(sql, provider);
  const start = await secureApi.request("/api/auth/login");
  const binding = start.headers.getSetCookie()[0]!;
  assert.match(binding, /^__Host-memegen_login=/);
  assert.match(binding, /; Secure/);
  assert.doesNotMatch(binding, /Domain=/i);
  const authorized = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await secureApi.request(authorized.headers.get("location")!, { headers: { cookie: binding.split(";")[0]! } });
  assert.equal(callback.status, 302);
  const session = callback.headers.getSetCookie().find((value) => value.startsWith("__Host-memegen_session="))!;
  assert.match(session, /; Secure/);
  assert.match(session, /; HttpOnly/);
  assert.match(session, /; SameSite=Lax/);
  assert.match(session, /; Path=\//);
  assert.doesNotMatch(session, /Domain=/i);
});

test("PKCE rejects a code when the saved verifier is not the original challenge preimage", async () => {
  const transaction = await beginLogin();
  await sql`update auth_login_transactions set code_verifier = ${randomBytes(32).toString("base64url")}
    where state_hash = ${createHash("sha256").update(transaction.state).digest("hex")}`;
  assert.equal((await api.request(transaction.callback, { headers: { cookie: transaction.cookie } })).status, 400);
});
