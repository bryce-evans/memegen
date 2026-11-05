import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AdminAnalytics, AuthSession } from "@memegen/shared";
import { HeaderAuthProvider, type Sql } from "@memegen/server-kit";
import { freshTestDb } from "@memegen/server-kit/testing";
import { createApiApp, type ApiApp } from "./app.ts";

let sql: Sql;
let api: ApiApp;
let adminId: string;
before(async () => {
  sql = await freshTestDb();
  api = createApiApp(sql, new HeaderAuthProvider(sql));
});
after(async () => { await sql.end(); });
beforeEach(async () => {
  await sql`truncate users, assets, daily_user_logins cascade`;
  const [admin] = await sql<{ id: string }[]>`insert into users (username, is_admin, created_at)
    values ('analytics_admin', true, '2000-01-01T00:00:00Z') returning id`;
  adminId = admin!.id;
});
async function analytics(days?: number): Promise<AdminAnalytics> {
  const response = await api.request(`/api/admin/analytics${days === undefined ? "" : `?days=${days}`}`, {
    headers: { "x-user-id": adminId },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return await response.json() as AdminAnalytics;
}
async function login(username: string): Promise<string> {
  const response = await api.request("/api/session", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json() as AuthSession).user!.id;
}
function day(date: string, offset: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
async function content(ownerId: string, createdAt: string) {
  const [asset] = await sql<{ id: string }[]>`insert into assets
    (kind, mime, name, filename, size_bytes, sha256, provider, storage_key, owner_id, width, height)
    values ('image', 'image/png', 'Analytics', 'analytics.png', 123, 'analytics-hash', 'local', 'analytics-key', ${ownerId}, 2, 2) returning id`;
  const [template] = await sql<{ id: string }[]>`insert into templates (name, asset_id, owner_id, created_at)
    values ('Analytics template', ${asset!.id}, ${ownerId}, ${createdAt}) returning id`;
  const [meme] = await sql<{ id: string }[]>`insert into memes
    (title, template_id, source_asset_id, output_asset_id, owner_id, created_at, posted_at, visibility)
    values ('Analytics post', ${template!.id}, ${asset!.id}, ${asset!.id}, ${ownerId}, '2000-01-01T00:00:00Z', ${createdAt}, 'unlisted') returning id`;
  return { asset: asset!.id, template: template!.id, meme: meme!.id };
}

test("only current administrators may read analytics, including after role revocation", async () => {
  assert.equal((await api.request("/api/admin/analytics")).status, 401);
  const userId = await login("ordinary");
  assert.equal((await api.request("/api/admin/analytics", { headers: { "x-user-id": userId, "x-is-admin": "true" } })).status, 403);
  await analytics();
  await sql`update users set is_admin = false where id = ${adminId}`;
  assert.equal((await api.request("/api/admin/analytics", { headers: { "x-user-id": adminId } })).status, 403);
});

test("successful dev sign-ins deduplicate per UTC day; session reads and failures never create activity", async () => {
  const id = await login("repeat_login");
  await Promise.all([login("repeat_login"), login("REPEAT_LOGIN")]);
  assert.equal((await analytics(7)).daily.at(-1)!.uniqueLogins, 1);
  // Move the successful login to yesterday: a restore today must not manufacture today's activity.
  await sql`update daily_user_logins set date = (now() at time zone 'UTC')::date - 1 where user_id = ${id}`;
  for (const path of ["/api/auth/session", "/api/me", "/api/auth/session"]) {
    assert.equal((await api.request(path, { headers: { "x-user-id": id } })).status, 200);
  }
  const failed = await api.request("/api/session", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"username":""}',
  });
  assert.equal(failed.status, 400);
  let report = await analytics(7);
  assert.equal(report.daily.at(-1)!.uniqueLogins, 0);
  assert.equal(report.daily.at(-2)!.uniqueLogins, 1);
  await login("repeat_login");
  await login("second_login");
  report = await analytics(7);
  assert.equal(report.daily.at(-1)!.uniqueLogins, 2);
  assert.equal(report.daily.at(-2)!.uniqueLogins, 1);
});

test("7/30/90 day windows are inclusive, ordered, zero-filled UTC days with stable tracking metadata", async () => {
  const initial = await analytics();
  assert.equal(initial.daily.length, 30);
  const [metadata] = await sql<{ started: Date }[]>`select login_tracking_started_at as started from analytics_metadata`;
  assert.equal(initial.loginTrackingStartedAt, metadata!.started.toISOString());
  for (const days of [7, 30, 90]) {
    const report = await analytics(days);
    assert.equal(report.timezone, "UTC");
    assert.equal(report.from, day(report.to, 1 - days));
    assert.deepEqual(report.daily, Array.from({ length: days }, (_, index) => ({
      date: day(report.from, index), uniqueLogins: 0, posts: 0, templates: 0, newUsers: 0, comments: 0,
    })));
    assert.equal(report.loginTrackingStartedAt, initial.loginTrackingStartedAt);
    assert.deepEqual(report.totals, { users: 1, posts: 0, templates: 0, drafts: 0, comments: 0, storageBytes: 0 });
  }
  for (const days of ["0", "8", "365", "-7", "7.0", "nope"]) {
    assert.equal((await api.request(`/api/admin/analytics?days=${days}`, { headers: { "x-user-id": adminId } })).status, 400);
  }
});

test("UTC boundaries use publication time; retained totals include old content and drafts, excluding built-in templates and their variations", async () => {
  const { to } = await analytics(7);
  const yesterday = day(to, -1);
  // These textual local dates cross midnight in opposite directions when converted to UTC.
  const late = `${yesterday}T23:30:00-02:00`;
  const early = `${to}T00:30:00+02:00`;
  const [owner] = await sql<{ id: string }[]>`insert into users (username, created_at) values ('creator', ${early}) returning id`;
  const f = await content(owner!.id, late);
  await sql`insert into templates (name, asset_id, owner_id, parent_id, created_at)
    values ('User variation', ${f.asset}, ${owner!.id}, ${f.template}, ${early})`;
  const [builtin] = await sql<{ id: string }[]>`insert into users (username) values ('MeMeGeN') returning id`;
  const [root] = await sql<{ id: string }[]>`insert into templates (name, asset_id, owner_id, created_at)
    values ('Builtin', ${f.asset}, ${builtin!.id}, ${late}) returning id`;
  await sql`insert into templates (name, asset_id, owner_id, parent_id, created_at)
    values ('Builtin variation', ${f.asset}, ${builtin!.id}, ${root!.id}, ${early})`;
  await sql`insert into memes (title, template_id, source_asset_id, output_asset_id, owner_id, posted_at)
    values ('Draft', ${f.template}, ${f.asset}, ${f.asset}, ${owner!.id}, null),
      ('Old post', ${f.template}, ${f.asset}, ${f.asset}, ${owner!.id}, '2000-01-01T00:00:00Z')`;
  await sql`insert into comments (body, meme_id, author_id, created_at, deleted_at)
    values ('Retained', ${f.meme}, ${owner!.id}, ${early}, null),
      ('Removed', ${f.meme}, ${owner!.id}, ${late}, now())`;
  await sql`insert into templates (name, asset_id, owner_id, created_at)
    values ('Default built-in ownership', ${f.asset}, null, '2000-01-01T00:00:00Z'),
      ('Old user template', ${f.asset}, ${owner!.id}, '2000-01-01T00:00:00Z')`;
  await sql`insert into daily_user_logins (date, user_id) values
    (${day(to, -7)}::date, ${owner!.id}),
    (${day(to, -6)}::date, ${owner!.id}),
    (${day(to, 1)}::date, ${owner!.id})`;
  const report = await analytics(7);
  assert.deepEqual(report.daily.at(-1), { date: to, uniqueLogins: 0, posts: 1, templates: 1, newUsers: 0, comments: 0 });
  assert.deepEqual(report.daily.at(-2), { date: yesterday, uniqueLogins: 0, posts: 0, templates: 1, newUsers: 1, comments: 1 });
  assert.deepEqual(report.totals, { users: 2, posts: 2, templates: 3, drafts: 1, comments: 1, storageBytes: 123 });
  assert.deepEqual((await analytics(90)).totals, report.totals);
  assert.equal(report.daily.reduce((sum, row) => sum + row.posts, 0), 1);
  assert.equal(report.daily[0]!.uniqueLogins, 1);
  assert.equal(report.daily.reduce((sum, row) => sum + row.uniqueLogins, 0), 1);
});

test("content deletion reduces retained totals and daily counts while deleted accounts retain successful sign-in history", async () => {
  const ownerId = await login("departing");
  const { to } = await analytics(7);
  const f = await content(ownerId, `${to}T00:00:00Z`);
  const [comment] = await sql<{ id: string }[]>`insert into comments (body, meme_id, author_id)
    values ('Delete me', ${f.meme}, ${ownerId}) returning id`;
  const before = await analytics(7);
  assert.deepEqual(before.totals, { users: 2, posts: 1, templates: 1, drafts: 0, comments: 1, storageBytes: 123 });
  for (const path of [`/api/comments/${comment!.id}`, `/api/memes/${f.meme}`, `/api/templates/${f.template}`]) {
    const response = await api.request(path, { method: "DELETE", headers: { "x-user-id": adminId } });
    assert.equal(response.status, 204, await response.clone().text());
  }
  // Storage owns byte deletion; remove the now-unreferenced fixture asset before the account API call.
  await sql`delete from assets where id = ${f.asset}`;
  const removed = await api.request(`/api/admin/users/${ownerId}`, { method: "DELETE", headers: { "x-user-id": adminId } });
  assert.equal(removed.status, 204, await removed.clone().text());
  const report = await analytics(7);
  assert.deepEqual(report.totals, { users: 1, posts: 0, templates: 0, drafts: 0, comments: 0, storageBytes: 0 });
  assert.deepEqual(report.daily.at(-1), { date: to, uniqueLogins: 1, posts: 0, templates: 0, newUsers: 0, comments: 0 });
  assert.equal(report.loginTrackingStartedAt, before.loginTrackingStartedAt);
});
