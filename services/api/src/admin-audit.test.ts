import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { Hono } from "hono";
import { DEFAULT_LIMITS, type AdminAuditEntry, type Page, type User } from "@memegen/shared";
import { HeaderAuthProvider, toUser, type Env, type Sql, type UserRow } from "@memegen/server-kit";
import { deletionTransaction } from "@memegen/server-kit/audit";
import { encodePng, freshTestDb } from "@memegen/server-kit/testing";
import { AssetStore, LocalStorageProvider, staticProviders } from "@memegen/storage";
import { createStorageApp } from "../../storage/src/app.ts";
import { createApiApp, type ApiApp } from "./app.ts";

let sql: Sql;
let api: ApiApp;
let storage: Hono<Env>;
let store: AssetStore;
let directory: string;
let admin: User;
let owner: User;
let outsider: User;
before(async () => {
  sql = await freshTestDb();
  directory = await mkdtemp(join(tmpdir(), "memegen-audit-"));
  store = new AssetStore(sql, staticProviders(new LocalStorageProvider(directory)), DEFAULT_LIMITS);
  api = createApiApp(sql, new HeaderAuthProvider(sql));
  storage = createStorageApp(store, new HeaderAuthProvider(sql));
});
after(async () => { await sql.end(); await rm(directory, { recursive: true, force: true }); });
beforeEach(async () => {
  // Audit has no FK: clearing fixtures intentionally does not clear immutable history.
  await sql`truncate users, assets cascade`;
  admin = await user("moderator", true);
  owner = await user("owner");
  outsider = await user("outsider");
});
async function user(username: string, isAdmin = false): Promise<User> {
  const [row] = await sql<UserRow[]>`insert into users (username, is_admin) values (${username}, ${isAdmin}) returning *`;
  return toUser(row!);
}
async function call(method: string, path: string, actor: User = admin): Promise<Response> {
  return (path.startsWith("/assets") ? storage : api).request(path, { method, headers: { "x-user-id": actor.id } });
}
async function remove(path: string, status = 204, actor = admin): Promise<Response> {
  const response = await call("DELETE", path, actor);
  assert.equal(response.status, status, await response.clone().text());
  return response;
}
async function asset(): Promise<string> {
  const id = crypto.randomUUID();
  const bytes = encodePng(2, 2);
  await store.providers.default.put(id, bytes, "image/png");
  await sql`insert into assets (id, kind, mime, name, filename, size_bytes, sha256, provider, storage_key, owner_id, width, height)
    values (${id}, 'image', 'image/png', 'Audit asset', 'audit.png', ${bytes.length}, 'test-hash', 'local', ${id}, ${owner.id}, 2, 2)`;
  return id;
}
async function fixture() {
  const assetId = await asset();
  const [template] = await sql<{ id: string }[]>`insert into templates (name, asset_id, owner_id)
    values ('Audit template', ${assetId}, ${owner.id}) returning id`;
  const [meme] = await sql<{ id: string }[]>`insert into memes (title, template_id, source_asset_id, output_asset_id, owner_id)
    values ('Audit meme', ${template!.id}, ${assetId}, ${assetId}, ${owner.id}) returning id`;
  const [comment] = await sql<{ id: string }[]>`insert into comments (body, meme_id, author_id)
    values ('Audit comment', ${meme!.id}, ${owner.id}) returning id`;
  const [tag] = await sql<{ id: string }[]>`insert into tags (name, slug, created_by)
    values ('Audit tag', 'audit-tag', ${owner.id}) returning id`;
  await sql`insert into template_tags (template_id, tag_id) values (${template!.id}, ${tag!.id})`;
  const [sticker] = await sql<{ id: string }[]>`insert into stickers (name, asset_id, owner_id)
    values ('Audit sticker', ${assetId}, ${owner.id}) returning id`;
  return { asset: assetId, template: template!.id, meme: meme!.id, comment: comment!.id, tag: tag!.id, sticker: sticker!.id };
}
async function audit(targetId: string): Promise<AdminAuditEntry[]> {
  const response = await call("GET", `/api/admin/audit?search=${targetId}`);
  assert.equal(response.status, 200);
  return ((await response.json()) as Page<AdminAuditEntry>).items;
}

test("only administrators browse audit history or delete other users' resources", async () => {
  const f = await fixture();
  assert.equal((await call("GET", "/api/admin/audit", outsider)).status, 403);
  assert.equal((await api.request("/api/admin/audit")).status, 401);
  for (const path of [`/api/memes/${f.meme}`, `/api/templates/${f.template}`, `/api/comments/${f.comment}`,
    `/api/admin/tags/${f.tag}`, `/api/admin/stickers/${f.sticker}`, `/assets/${f.asset}`, `/api/admin/users/${owner.id}`]) {
    await remove(path, 403, outsider);
  }
  assert.deepEqual(await audit(f.meme), []);
  await remove(`/api/comments/${f.comment}`, 204, owner);
  assert.deepEqual(await audit(f.comment), [], "normal owner deletions are not admin actions");
});

test("admin clears all seven resource kinds; conflicts preserve content and never report successful audit", async () => {
  const f = await fixture();
  await remove(`/api/templates/${f.template}`, 409);
  const assetConflict = await remove(`/assets/${f.asset}`, 409);
  const conflict = await assetConflict.json() as { details: string[] };
  for (const id of [f.template, f.meme, f.sticker]) assert.ok(conflict.details.some((detail) => detail.includes(id)));
  const blocked = await remove(`/api/admin/users/${owner.id}`, 409);
  assert.match(await blocked.text(), /memes.*templates.*comments.*tags.*stickers.*assets/);
  assert.deepEqual(await audit(f.template), []);
  assert.deepEqual(await audit(f.asset), []);
  assert.deepEqual(await audit(owner.id), []);
  const deletions = [
    ["comments", f.comment, `/api/comments/${f.comment}`],
    ["memes", f.meme, `/api/memes/${f.meme}`],
    ["templates", f.template, `/api/templates/${f.template}`],
    ["tags", f.tag, `/api/admin/tags/${f.tag}`],
    ["stickers", f.sticker, `/api/admin/stickers/${f.sticker}`],
    ["assets", f.asset, `/assets/${f.asset}`],
    ["users", owner.id, `/api/admin/users/${owner.id}`],
  ] as const;
  for (const [kind, id, path] of deletions) {
    await remove(path);
    const entries = await audit(id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.targetKind, kind);
    assert.equal(entries[0]!.targetId, id);
    assert.equal(entries[0]!.actorId, admin.id);
    assert.equal(entries[0]!.actorName, admin.username);
    assert.equal(entries[0]!.action, "delete");
    assert.ok(Number.isFinite(Date.parse(entries[0]!.createdAt)));
    assert.deepEqual(Object.keys(entries[0]!.snapshot).sort(), ["assetId", "memeId", "ownerId", "parentId"]);
  }
  assert.equal((await storage.request(`/assets/${f.asset}/content`)).status, 404);
});

test("bulk dependent deletion audits every meme and cascaded comment, and template removal audits variations", async () => {
  const f = await fixture();
  const [variation] = await sql<{ id: string }[]>`insert into templates (name, asset_id, parent_id, owner_id)
    values ('Audit variation', ${f.asset}, ${f.template}, ${owner.id}) returning id`;
  const [child] = await sql<{ id: string }[]>`insert into memes (title, template_id, source_asset_id, output_asset_id, owner_id)
    values ('Variation meme', ${variation!.id}, ${f.asset}, ${f.asset}, ${owner.id}) returning id`;
  await remove(`/api/admin/templates/${f.template}/memes`);
  for (const id of [f.meme, child!.id, f.comment]) assert.equal((await audit(id))[0]!.actorId, admin.id);
  await remove(`/api/templates/${f.template}`);
  assert.equal((await audit(variation!.id))[0]!.targetKind, "templates");
});

test("soft deletion is audited once, then reply removal and placeholder cleanup remain auditable", async () => {
  const f = await fixture();
  const [reply] = await sql<{ id: string }[]>`insert into comments (body, meme_id, parent_id, author_id)
    values ('Reply', ${f.meme}, ${f.comment}, ${outsider.id}) returning id`;
  await remove(`/api/comments/${f.comment}`);
  await remove(`/api/comments/${f.comment}`);
  assert.deepEqual((await audit(f.comment)).map((entry) => entry.action), ["soft_delete"]);
  await remove(`/api/comments/${reply!.id}`);
  assert.deepEqual((await audit(f.comment)).map((entry) => entry.action), ["delete", "soft_delete"]);
  assert.equal((await audit(reply!.id))[0]!.targetKind, "comments");
});

test("audit and deletions roll back together; stale admin roles cannot authorize deletion", async () => {
  const f = await fixture();
  await assert.rejects(deletionTransaction(sql, admin, async (tx) => {
    await tx`delete from memes where id = ${f.meme}`;
    throw new Error("abort transaction");
  }), /abort transaction/);
  assert.deepEqual(await audit(f.meme), []);
  assert.deepEqual(await audit(f.comment), []);
  assert.equal((await sql`select id from memes where id = ${f.meme}`).length, 1);
  await sql`update users set is_admin = false where id = ${admin.id}`;
  await assert.rejects(deletionTransaction(sql, admin, async (tx) => {
    await tx`delete from memes where id = ${f.meme}`;
  }), /admin role required/);
  await sql`update users set is_admin = true where id = ${admin.id}`;
  await remove(`/api/memes/${f.meme}`);
  assert.equal((await audit(f.meme)).length, 1);
  assert.equal((await audit(f.comment)).length, 1);
});

test("a newly granted administrator is audited using their current role and name", async () => {
  const f = await fixture();
  await sql`update users set is_admin = true, username = 'new-admin-name' where id = ${owner.id}`;
  await deletionTransaction(sql, owner, async (tx) => { await tx`delete from memes where id = ${f.meme}`; });
  const entries = await audit(f.meme);
  assert.equal(entries[0]!.actorId, owner.id);
  assert.equal(entries[0]!.actorName, "new-admin-name");
});

test("history is immutable and survives target and actor removal without exposing account internals", async () => {
  const f = await fixture();
  await remove(`/api/memes/${f.meme}`);
  const entry = (await audit(f.meme))[0]!;
  for (const change of [
    sql`update admin_audit set label = 'tampered' where id = ${entry.id}`,
    sql`delete from admin_audit where id = ${entry.id}`,
    sql`truncate admin_audit`,
  ]) await assert.rejects(change, /immutable/);
  const successor = await user("successor", true);
  await remove(`/api/admin/users/${admin.id}`, 204, successor);
  const response = await call("GET", `/api/admin/audit?search=${f.meme}`, successor);
  const entries = (await response.json() as Page<AdminAuditEntry>).items;
  assert.deepEqual(entries, [entry]);
  assert.equal(JSON.stringify(entries).includes("negativeHScore"), false);
});

test("built-in, self, and concurrent last-admin deletion protections preserve an administrator", async () => {
  const [builtin] = await sql<{ id: string }[]>`select memegen_user_id() as id`;
  await remove(`/api/admin/users/${builtin!.id}`, 409);
  await remove(`/api/admin/users/${admin.id}`, 409);
  const second = await user("second-admin", true);
  const responses = await Promise.all([
    call("DELETE", `/api/admin/users/${second.id}`, admin),
    call("DELETE", `/api/admin/users/${admin.id}`, second),
  ]);
  assert.equal(responses.filter((response) => response.status === 204).length, 1);
  assert.ok(responses.every((response) => [204, 401].includes(response.status)));
  const [remaining] = await sql<{ total: number }[]>`select count(*)::int as total from users where is_admin`;
  assert.equal(remaining!.total, 1);
});

test("storage byte cleanup failure reports committed metadata deletion and retains its audit", async () => {
  const id = await asset();
  class FailingDeleteProvider extends LocalStorageProvider {
    override async delete(): Promise<void> { throw new Error("provider unavailable"); }
  }
  const brokenStore = new AssetStore(sql, staticProviders(new FailingDeleteProvider(directory)), DEFAULT_LIMITS);
  const brokenStorage = createStorageApp(brokenStore, new HeaderAuthProvider(sql));
  const response = await brokenStorage.request(`/assets/${id}`, { method: "DELETE", headers: { "x-user-id": admin.id } });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /metadata was deleted, but stored bytes/);
  assert.equal((await sql`select id from assets where id = ${id}`).length, 0);
  assert.equal((await audit(id)).length, 1);
  const bytes = await store.providers.default.get(id);
  assert.ok(Buffer.from(await new Response(bytes.body).arrayBuffer()).equals(encodePng(2, 2)));
});
