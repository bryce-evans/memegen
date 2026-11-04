import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { Hono } from "hono";
import { DEFAULT_LIMITS, newImageLayer, newTextLayer, type Asset, type Layer } from "@memegen/shared";
import { HeaderAuthProvider, type Env, type Sql } from "@memegen/server-kit";
import { encodePng, freshTestDb } from "@memegen/server-kit/testing";
import { AssetStore, LocalStorageProvider, staticProviders } from "@memegen/storage";
import { createStorageApp } from "../../storage/src/app.ts";
import { createApiApp, type ApiApp } from "./app.ts";

let sql: Sql;
let dir: string;
let store: AssetStore;
let api: ApiApp;
let storage: Hono<Env>;
let ownerId: string;

before(async () => {
  sql = await freshTestDb();
  dir = await mkdtemp(join(tmpdir(), "memegen-references-"));
  store = new AssetStore(sql, staticProviders(new LocalStorageProvider(dir)), DEFAULT_LIMITS);
  api = createApiApp(sql, new HeaderAuthProvider(sql));
  storage = createStorageApp(store, new HeaderAuthProvider(sql));
});
after(async () => {
  await sql.end();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await sql`truncate users, assets cascade`;
  const [owner] = await sql<{ id: string }[]>`insert into users (username) values ('asset-owner') returning id`;
  ownerId = owner!.id;
});

async function asset(kind: "image" | "font" = "image"): Promise<Asset> {
  const result = await store.upload({ data: encodePng(4, 4), filename: "asset.png", ownerId });
  // The reference tests exercise metadata, not font decoding.
  if (kind === "font") await sql`update assets set kind = 'font' where id = ${result.id}`;
  return result;
}

async function request(method: string, path: string, body: unknown): Promise<Response> {
  return api.request(path, {
    method,
    headers: { "content-type": "application/json", "x-user-id": ownerId },
    body: JSON.stringify(body),
  });
}

async function remove(id: string): Promise<Response> {
  return storage.request(`/assets/${id}`, { method: "DELETE", headers: { "x-user-id": ownerId } });
}

async function template(layers: Layer[] = []): Promise<string> {
  const cover = await asset();
  const [row] = await sql<{ id: string }[]>`
    insert into templates (name, owner_id, asset_id, default_layers)
    values ('References', ${ownerId}, ${cover.id}, ${sql.json(layers as never)}) returning id`;
  return row!.id;
}

async function meme(templateId: string, layers: Layer[] = []): Promise<string> {
  const output = await asset();
  const [row] = await sql<{ id: string }[]>`
    insert into memes (owner_id, template_id, source_asset_id, output_asset_id, title, layers)
    values (${ownerId}, ${templateId}, ${output.id}, ${output.id}, 'References', ${sql.json(layers as never)}) returning id`;
  return row!.id;
}

async function assertPinned(value: Asset): Promise<void> {
  const response = await remove(value.id);
  assert.equal(response.status, 409, await response.text());
  const content = await storage.request(value.contentPath);
  assert.equal(content.status, 200);
  assert.ok(Buffer.from(await content.arrayBuffer()).equals(encodePng(4, 4)), "referenced asset bytes must remain unchanged");
}

const foreignKeyViolation = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "23503";

test("asset DELETE returns 409 and retains bytes for every scalar reference", async () => {
  const cover = await asset();
  const source = await asset();
  const output = await asset();
  const pack = await asset();
  const sticker = await asset();
  const [base] = await sql<{ id: string }[]>`
    insert into templates (name, asset_id) values ('Scalar references', ${cover.id}) returning id`;
  await sql`insert into template_pack_assets (template_id, asset_id, position) values (${base!.id}, ${pack.id}, 0)`;
  await sql`insert into stickers (name, asset_id) values ('Sticker', ${sticker.id})`;
  const [made] = await sql<{ id: string }[]>`
    insert into memes (owner_id, template_id, source_asset_id, output_asset_id)
    values (${ownerId}, ${base!.id}, ${source.id}, ${output.id}) returning id`;
  for (const value of [cover, source, output, pack, sticker]) await assertPinned(value);
  await sql`delete from memes where id = ${made!.id}`;
  await sql`delete from templates where id = ${base!.id}`;
  await sql`delete from stickers where asset_id = ${sticker.id}`;
  for (const value of [cover, source, output, pack, sticker]) {
    assert.equal((await remove(value.id)).status, 204);
    assert.equal((await storage.request(value.contentPath)).status, 404);
  }
});

test("template and meme JSON references pin images and fonts through edits and deletion", async () => {
  const image = await asset();
  const font = await asset("font");
  const replacement = await asset("font");
  const layers = [newImageLayer(image.id), newTextLayer({ fontAssetId: font.id }), newTextLayer({ fontAssetId: font.id })];
  const base = await template(layers);
  const made = await meme(base, layers);
  await assertPinned(image);
  await assertPinned(font);
  await sql`update templates set default_layers = '[]' where id = ${base}`;
  await assertPinned(image);
  await assertPinned(font);
  await sql`update memes set layers = ${sql.json([newTextLayer({ fontAssetId: replacement.id })] as never)} where id = ${made}`;
  assert.equal((await remove(image.id)).status, 204);
  assert.equal((await remove(font.id)).status, 204);
  await assertPinned(replacement);
  await sql`delete from memes where id = ${made}`;
  assert.equal((await remove(replacement.id)).status, 204);
  const defaultFont = await asset("font");
  await sql`update templates set default_layers = ${sql.json([newTextLayer({ fontAssetId: defaultFont.id })] as never)} where id = ${base}`;
  await assertPinned(defaultFont);
  await sql`delete from templates where id = ${base}`;
  assert.equal((await remove(defaultFont.id)).status, 204);
});

test("JSON panel references remain protected independently of pack membership", async () => {
  const image = await asset();
  const base = await template();
  const made = await meme(base);
  const panels = [{ id: "panel", assetId: image.id, text: "Caption" }];
  await sql`update templates set panels = ${sql.json({ layout: "vertical", defaultPanels: panels })} where id = ${base}`;
  await sql`update memes set panels = ${sql.json({ layout: "vertical", panels })} where id = ${made}`;
  await assertPinned(image);
  await sql`update templates set panels = null where id = ${base}`;
  await assertPinned(image);
  await sql`update memes set panels = null where id = ${made}`;
  assert.equal((await remove(image.id)).status, 204);
});

test("direct writes cannot insert or replace JSON references with missing images or fonts", async () => {
  const font = await asset("font");
  const original = [newTextLayer({ fontAssetId: font.id })];
  const base = await template(original);
  const made = await meme(base, original);
  for (const missing of [newImageLayer(crypto.randomUUID()), newTextLayer({ fontAssetId: crypto.randomUUID() })]) {
    await assert.rejects(template([missing]), foreignKeyViolation);
    await assert.rejects(meme(base, [missing]), foreignKeyViolation);
    await assert.rejects(sql`update templates set default_layers = ${sql.json([missing] as never)} where id = ${base}`, foreignKeyViolation);
    await assert.rejects(sql`update memes set layers = ${sql.json([missing] as never)} where id = ${made}`, foreignKeyViolation);
  }
  const [savedTemplate] = await sql<{ default_layers: Layer[] }[]>`select default_layers from templates where id = ${base}`;
  const [savedMeme] = await sql<{ layers: Layer[] }[]>`select layers from memes where id = ${made}`;
  assert.deepEqual(savedTemplate!.default_layers, original);
  assert.deepEqual(savedMeme!.layers, original);
  await assertPinned(font);
});

test("API accepts uploaded fonts and rejects missing or wrong-kind fonts on create and edit", async () => {
  const cover = await asset();
  const font = await asset("font");
  const layers = [newTextLayer({ fontAssetId: font.id })];
  const response = await request("POST", "/api/templates", { name: "Font defaults", assetId: cover.id, defaultLayers: layers });
  assert.equal(response.status, 201);
  const base: { id: string } = await response.json();
  const output = await asset();
  const madeResponse = await request("POST", "/api/memes", { title: "Font meme", templateId: base.id, outputAssetId: output.id, layers });
  assert.equal(madeResponse.status, 201);
  const made: { id: string } = await madeResponse.json();
  for (const fontAssetId of [crypto.randomUUID(), cover.id]) {
    const invalid = [newTextLayer({ fontAssetId })];
    assert.equal((await request("POST", "/api/templates", { name: "Bad font", assetId: cover.id, defaultLayers: invalid })).status, 400);
    assert.equal((await request("PATCH", `/api/templates/${base.id}`, { defaultLayers: invalid })).status, 400);
    assert.equal((await request("POST", "/api/memes", { title: "Bad font", templateId: base.id, outputAssetId: output.id, layers: invalid })).status, 400);
    assert.equal((await request("PATCH", `/api/memes/${made.id}`, { outputAssetId: output.id, layers: invalid })).status, 400);
  }
  await assertPinned(font);
});

/** Observe actual PostgreSQL lock contention, not a delay that merely hopes a competing write started. */
async function waitForBlockedBy(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const [row] = await sql<{ blocked: boolean }[]>`
      select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as blocked`;
    if (row!.blocked) return;
  }
  assert.fail("competing operation did not reach the database lock");
}

test("a committed JSON reference wins a concurrent storage delete and preserves its bytes", async () => {
  const font = await asset("font");
  const cover = await asset();
  const ready = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const writing = sql.begin(async (tx) => {
    const [connection] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await tx`insert into templates (name, asset_id, default_layers)
      values ('Concurrent font', ${cover.id}, ${tx.json([newTextLayer({ fontAssetId: font.id })] as never)})`;
    ready.resolve(connection!.pid);
    await release.promise;
  });
  void writing.catch(ready.reject);
  const pid = await ready.promise;
  const deleting = remove(font.id);
  try {
    await waitForBlockedBy(pid);
  } finally {
    release.resolve();
  }
  await writing;
  assert.equal((await deleting).status, 409);
  await assertPinned(font);
});

test("asset deletion after API preflight rejects the concurrent write without leaving a partial template", async () => {
  const image = await asset();
  const cover = await asset();
  const ready = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const deleting = sql.begin(async (tx) => {
    const [connection] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await tx`delete from assets where id = ${image.id}`;
    ready.resolve(connection!.pid);
    await release.promise;
  });
  void deleting.catch(ready.reject);
  const pid = await ready.promise;
  const writing = request("POST", "/api/templates", { name: "Lost delete race", assetId: cover.id, defaultLayers: [newImageLayer(image.id)] });
  try {
    await waitForBlockedBy(pid);
  } finally {
    release.resolve();
  }
  await deleting;
  assert.equal((await writing).status, 400);
  const remaining = await sql`select id from templates where name = 'Lost delete race'`;
  assert.equal(remaining.length, 0);
});

test("removing a JSON reference concurrently releases the asset only when the edit commits", async () => {
  const image = await asset();
  const base = await template([newImageLayer(image.id)]);
  const ready = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const writing = sql.begin(async (tx) => {
    const [connection] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await tx`update templates set default_layers = '[]' where id = ${base}`;
    ready.resolve(connection!.pid);
    await release.promise;
  });
  void writing.catch(ready.reject);
  const pid = await ready.promise;
  const deleting = remove(image.id);
  try {
    await waitForBlockedBy(pid);
  } finally {
    release.resolve();
  }
  await writing;
  assert.equal((await deleting).status, 204);
  assert.equal((await storage.request(image.contentPath)).status, 404);
});
