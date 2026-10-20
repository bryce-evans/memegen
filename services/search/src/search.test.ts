import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { searchConfig, type Sql } from "@memegen/server-kit";
import { encodePng, freshTestDb } from "@memegen/server-kit/testing";
import { DUPLICATE_MIN_SIMILARITY, TemplateCatalog, type FetchAsset } from "./catalog.ts";
import { Clip } from "./clip.ts";

// The real CLIP model (downloaded into SEARCH_DATA_DIR on first use, shared with dev), against the test database.
let sql: Sql;
let clip: Promise<Clip>;
let dir: string;
const bytes = new Map<string, Uint8Array>();
let fetches = 0;
const fetchAsset: FetchAsset = async (assetId) => {
  fetches++;
  const data = bytes.get(assetId);
  if (!data) throw new Error("no such object");
  return data;
};

before(async () => {
  sql = await freshTestDb();
  clip = Clip.load(searchConfig.model, searchConfig.dataDir);
  await clip;
});

after(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate users, assets cascade`;
  dir = await mkdtemp(join(tmpdir(), "memegen-search-"));
  fetches = 0;
});

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Pattern = "rings" | "stripes" | "checker";

/** A size×size picture of `pattern`; `jitter` nudges every pixel so the bytes differ from another copy. */
function picture(pattern: Pattern, size: number, jitter = 0): Uint8Array {
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let c: [number, number, number];
      if (pattern === "rings") c = Math.floor(Math.hypot(u - 0.5, v - 0.5) * 12) % 2 ? [220, 30, 30] : [250, 220, 40];
      else if (pattern === "stripes") c = Math.floor(u * 10) % 2 ? [20, 40, 200] : [245, 245, 245];
      else c = (Math.floor(u * 6) + Math.floor(v * 6)) % 2 ? [10, 10, 10] : [30, 180, 60];
      const i = (y * size + x) * 3;
      for (let k = 0; k < 3; k++) rgb[i + k] = Math.max(0, Math.min(255, c[k]! + (((x * 7 + y * 13 + k) % 5) - 2) * jitter));
    }
  }
  return encodePng(size, size, rgb);
}

async function asset(data: Uint8Array, kind = "image"): Promise<string> {
  const id = crypto.randomUUID();
  await sql`insert into assets ${sql({
    id,
    kind,
    mime: kind === "video" ? "video/mp4" : "image/png",
    name: "t",
    filename: "t.png",
    size_bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    provider: "local",
    storage_key: id,
  })}`;
  bytes.set(id, data);
  return id;
}

async function template(name: string, assetId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`insert into templates (name, asset_id) values (${name}, ${assetId}) returning id`;
  return row!.id;
}

const catalog = () => new TemplateCatalog(sql, clip, fetchAsset, dir, searchConfig.model);

test("similar: a resized, re-encoded copy finds its template; different pictures don't", async () => {
  const rings = await template("Rings", await asset(picture("rings", 224)));
  await template("Stripes", await asset(picture("stripes", 224)));
  await template("Checker", await asset(picture("checker", 224)));
  const search = catalog();

  const hits = await search.similar(await asset(picture("rings", 160, 3)), 10);
  assert.deepEqual(
    hits.map((h) => h.templateId),
    [rings],
  );
  assert.ok(hits[0]!.score >= DUPLICATE_MIN_SIMILARITY && hits[0]!.score <= 1);
});

test("the index follows the templates table: new templates appear, deleted ones go, videos are skipped", async () => {
  const search = catalog();
  const copy = await asset(picture("stripes", 200, 2));
  assert.deepEqual(await search.similar(copy, 10), []);

  const stripes = await template("Stripes", await asset(picture("stripes", 224)));
  await template("Clip", await asset(new Uint8Array([0, 0, 0]), "video"));
  assert.deepEqual((await search.similar(copy, 10)).map((h) => h.templateId), [stripes]);
  assert.equal(search.size, 1);

  await sql`delete from templates where id = ${stripes}`;
  assert.deepEqual(await search.similar(copy, 10), []);
  assert.equal(search.size, 0);
});

test("embeddings are cached on disk by content: a restarted catalog fetches nothing it has seen", async () => {
  const image = picture("checker", 224);
  const checker = await template("Checker", await asset(image));
  await catalog().sync();
  assert.equal(fetches, 1);

  // Same bytes under another asset (and template) are not fetched again either.
  const again = await template("Checker again", await asset(image));
  const restarted = catalog();
  await restarted.sync();
  assert.equal(fetches, 1);
  assert.equal(restarted.size, 2);
  const hits = await restarted.similar(await asset(image), 10);
  assert.deepEqual(hits.map((h) => h.templateId).sort(), [checker, again].sort());
});
