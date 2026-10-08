import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { openPromise } from "yauzl";
import { ZipFile } from "yazl";
import { DEFAULT_LIMITS } from "@memegen/shared";
import { createSql, migrate, migrationFiles, MIGRATIONS_DIR, type Sql } from "@memegen/server-kit";
import { TEST_DATABASE_URL } from "@memegen/server-kit/testing";
import { AssetStore, LocalStorageProvider, staticProviders, type Providers } from "@memegen/storage";
import { insertTemplate } from "../lib.ts";
import { loadSnapshot } from "./load.ts";
import { MANIFEST_PATH, type Manifest } from "./manifest.ts";
import { saveSnapshot } from "./save.ts";

const SOURCE_URL = TEST_DATABASE_URL;
const TARGET_URL = process.env.SNAPSHOT_TEST_DATABASE_URL ?? "postgres://localhost:5432/memegen_snapshot_test";

let dir: string;
let source: Sql;
let target: Sql;
let sourceProviders: Providers;
let targetProviders: Providers;
let sourceStorage: string;
let targetStorage: string;

function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height))),
    chunk("IEND", new Uint8Array()),
  ]);
}

async function emptySchema(sql: Sql): Promise<void> {
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
}

/** Migrations 001..last, copied into their own folder: the schema of older code. */
async function migrationsUpTo(last: string): Promise<string> {
  const out = join(dir, `migrations-${last}`);
  await mkdir(out, { recursive: true });
  for (const file of (await migrationFiles()).filter((f) => f <= last)) await copyFile(join(MIGRATIONS_DIR, file), join(out, file));
  return out;
}

interface Fixture {
  stickerAsset: string;
  memeId: string;
}

/** A user-made meme carrying a sticker, a vote, a comment, a template, and an upload nothing uses. */
async function seedFixture(sql: Sql): Promise<Fixture> {
  const store = new AssetStore(sql, sourceProviders, DEFAULT_LIMITS);
  const [dana] = await sql<{ id: string }[]>`insert into users (username) values ('dana') returning id`;
  const [eli] = await sql<{ id: string }[]>`insert into users (username) values ('eli') returning id`;
  const base = await store.upload({ data: png(40, 30), filename: "base.png", ownerId: null });
  const templateId = await insertTemplate(sql, { slug: "base", name: "Base Template", assetId: base.id, layers: [] });
  const star = await store.upload({ data: png(8, 8), filename: "star.png", ownerId: dana!.id });
  await sql`insert into stickers (name, asset_id, owner_id) values ('Gold Star', ${star.id}, ${dana!.id})`;
  const output = await store.upload({ data: png(41, 30), filename: "out.png", ownerId: dana!.id });
  const layers = [{ type: "image", id: "l1", assetId: star.id, x: 0.5, y: 0.5, width: 0.2, angle: 0, opacity: 1, start: null, end: null, keyframes: [] }];
  const [meme] = await sql<{ id: string }[]>`
    insert into memes ${sql({
      owner_id: dana!.id,
      template_id: templateId,
      source_asset_id: base.id,
      output_asset_id: output.id,
      title: "Friday Deploys",
      layers: sql.json(layers as never),
      posted_at: new Date(),
    })} returning id`;
  await sql`insert into votes (user_id, meme_id, value) values (${eli!.id}, ${meme!.id}, 1)`;
  await sql`insert into comments (meme_id, author_id, body) values (${meme!.id}, ${eli!.id}, 'ship it')`;
  await store.upload({ data: png(5, 5), filename: "pasted.png", ownerId: eli!.id });
  return { stickerAsset: star.id, memeId: meme!.id };
}

/** Every row of every table, for comparing two databases. */
async function tableContents(sql: Sql): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const { tablename } of await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' order by 1`) {
    const [row] = await sql<{ rows: unknown }[]>`select coalesce(json_agg(t order by t::text), '[]') as rows from ${sql(tablename)} t`;
    out[tablename] = row!.rows;
  }
  return out;
}

async function zipEntries(file: string): Promise<string[]> {
  const zip = await openPromise(file, { lazyEntries: true });
  const names: string[] = [];
  for await (const entry of zip.eachEntry()) names.push(entry.fileName);
  zip.close();
  return names;
}

/** Copies a snapshot, passing its manifest through `edit`. */
async function rewriteManifest(file: string, out: string, edit: (m: Manifest) => void): Promise<void> {
  const zip = await openPromise(file, { lazyEntries: true, autoClose: false });
  const copy = new ZipFile();
  const written = pipeline(copy.outputStream, createWriteStream(out));
  for await (const entry of zip.eachEntry()) {
    const chunks: Buffer[] = [];
    for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
    let data = Buffer.concat(chunks);
    if (entry.fileName === MANIFEST_PATH) {
      const manifest = JSON.parse(data.toString("utf8")) as Manifest;
      edit(manifest);
      data = Buffer.from(JSON.stringify(manifest));
    }
    copy.addBuffer(data, entry.fileName);
  }
  zip.close();
  copy.end();
  await written;
}

// Each test drops and recreates both schemas, so each gets fresh connections: postgres.js caches prepared
// statements and type ids per connection, which go stale when the schema is recreated.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "memegen-snapshot-test-"));
  sourceStorage = join(dir, "source-storage");
  targetStorage = join(dir, "target-storage");
  sourceProviders = staticProviders(new LocalStorageProvider(sourceStorage));
  targetProviders = staticProviders(new LocalStorageProvider(targetStorage));
  for (const url of [SOURCE_URL, TARGET_URL]) {
    const sql = createSql(url);
    await emptySchema(sql);
    await sql.end();
  }
  source = createSql(SOURCE_URL);
  target = createSql(TARGET_URL);
});

afterEach(async () => {
  await source.end();
  await target.end();
  await rm(dir, { recursive: true, force: true });
});

test("a snapshot restores every row and asset byte into a clean system, without re-running triggers", async () => {
  await migrate(source);
  await seedFixture(source);
  const file = join(dir, "full.zip");
  const manifest = await saveSnapshot(source, { databaseUrl: SOURCE_URL, providers: sourceProviders, out: file, label: "backup" });

  const names = await zipEntries(file);
  assert.deepEqual(
    names.filter((n) => n.startsWith("assets/")).map((n) => n.replace(/--[0-9a-f]{8}\.png$/, "")).sort(),
    ["assets/memes/dana-friday-deploys", "assets/stickers/gold-star", "assets/templates/base-template", "assets/uploads/pasted"],
  );
  assert.ok(names.includes("db/memegen.dump") && names.includes("db/schema.sql"));

  const result = await loadSnapshot(target, { databaseUrl: TARGET_URL, providers: targetProviders, file });
  assert.deepEqual(result.migrated, []);
  // Usage logs and vote tallies match exactly: restoring must not fire the triggers that write them.
  assert.deepEqual(await tableContents(target), await tableContents(source));
  for (const a of manifest.assets) {
    assert.deepEqual(await readFile(join(targetStorage, a.storageKey)), await readFile(join(sourceStorage, a.storageKey)));
  }
});

test("a migrated but empty target (after setup) counts as clean", async () => {
  await migrate(source);
  await seedFixture(source);
  const file = join(dir, "full.zip");
  await saveSnapshot(source, { databaseUrl: SOURCE_URL, providers: sourceProviders, out: file, label: "backup" });
  await migrate(target);

  await loadSnapshot(target, { databaseUrl: TARGET_URL, providers: targetProviders, file });
  assert.deepEqual(await tableContents(target), await tableContents(source));
});

test("a snapshot from older code loads and is migrated forward", async () => {
  const old = await migrationsUpTo("012_stickers.sql");
  await migrate(source, old);
  const { memeId } = await seedFixture(source);
  const file = join(dir, "old.zip");
  const manifest = await saveSnapshot(source, { databaseUrl: SOURCE_URL, providers: sourceProviders, out: file, label: "backup", migrationsDir: old });
  assert.equal(manifest.migrations.at(-1), "012_stickers.sql");

  const result = await loadSnapshot(target, { databaseUrl: TARGET_URL, providers: targetProviders, file });
  assert.deepEqual(result.migrated, ["013_sticker_uses.sql"]);
  // 013's backfill ran over the restored meme.
  const uses = await target<{ kind: string }[]>`select kind from sticker_uses where meme_id = ${memeId} order by kind`;
  assert.deepEqual(uses.map((u) => u.kind), ["created", "posted"]);
});

test("load refuses a target with data, newer snapshots, and corrupt files, leaving the target untouched", async () => {
  await migrate(source);
  await seedFixture(source);
  const file = join(dir, "full.zip");
  await saveSnapshot(source, { databaseUrl: SOURCE_URL, providers: sourceProviders, out: file, label: "backup" });
  const load = (f: string, migrationsDir?: string) => loadSnapshot(target, { databaseUrl: TARGET_URL, providers: targetProviders, file: f, migrationsDir });
  const targetTables = async () => (await target`select 1 from pg_tables where schemaname = 'public'`).length;

  await assert.rejects(load(file, await migrationsUpTo("012_stickers.sql")), /newer code.*013_sticker_uses\.sql/);
  assert.equal(await targetTables(), 0);

  const corrupt = join(dir, "corrupt.zip");
  await rewriteManifest(file, corrupt, (m) => (m.assets[0]!.sha256 = "0".repeat(64)));
  await assert.rejects(load(corrupt), /is corrupt/);
  assert.equal(await targetTables(), 0);

  const future = join(dir, "future.zip");
  await rewriteManifest(file, future, (m) => Object.assign(m, { format: 2 }));
  await assert.rejects(load(future), /format 2 is not supported/);

  await migrate(target);
  await target`insert into users (username) values ('existing')`;
  await assert.rejects(load(file), /target database has data/);
  assert.equal((await target`select username from users`).map((u) => u.username).join(), "existing");
});

test("save fails, writing no zip, when an asset's bytes are missing", async () => {
  await migrate(source);
  const { stickerAsset } = await seedFixture(source);
  const [row] = await source<{ storage_key: string }[]>`select storage_key from assets where id = ${stickerAsset}`;
  await rm(join(sourceStorage, row!.storage_key));
  const file = join(dir, "missing.zip");

  await assert.rejects(
    saveSnapshot(source, { databaseUrl: SOURCE_URL, providers: sourceProviders, out: file, label: "backup" }),
    new RegExp(`1 asset\\(s\\) could not be saved:\\s+${stickerAsset}`),
  );
  await assert.rejects(access(file));
  await assert.rejects(access(`${file}.partial`));
});

test("save refuses a database whose migrations don't match the code", async () => {
  await migrate(source, await migrationsUpTo("012_stickers.sql"));
  await assert.rejects(
    saveSnapshot(source, { databaseUrl: SOURCE_URL, providers: sourceProviders, out: join(dir, "x.zip"), label: "backup" }),
    /migrations don't match/,
  );
});
