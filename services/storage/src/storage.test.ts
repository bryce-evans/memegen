import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { DEFAULT_LIMITS, type Asset, type UploadLimits } from "@memegen/shared";
import { HeaderAuthProvider, type Sql } from "@memegen/server-kit";
import type * as Gifenc from "gifenc";
import type { Hono } from "hono";
import { freshTestDb } from "@memegen/server-kit/testing";
import { AssetStore } from "./assets.ts";
import { createStorageApp } from "./app.ts";
import { readGifInfo } from "./gif.ts";
import { LocalStorageProvider } from "./providers/local.ts";
import { staticProviders } from "./providers/registry.ts";

const { applyPalette, GIFEncoder, quantize } = createRequire(import.meta.url)("gifenc") as typeof Gifenc;

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
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit grayscale
  const raw = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

function gif(width: number, height: number, delaysMs: number[]): Uint8Array {
  const enc = GIFEncoder();
  const rgba = new Uint8Array(width * height * 4).fill(200);
  const palette = quantize(rgba, 4);
  for (const delay of delaysMs) {
    enc.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay });
  }
  enc.finish();
  return enc.bytes();
}

const limits: UploadLimits = {
  ...DEFAULT_LIMITS,
  maxBytes: 200_000,
  image: { maxDimension: 300 },
  gif: { maxDimension: 64, maxFrames: 3 },
};

let sql: Sql;
let dir: string;
let app: Hono;

before(async () => {
  sql = await freshTestDb();
  dir = await mkdtemp(join(tmpdir(), "memegen-storage-"));
  const store = new AssetStore(sql, staticProviders(new LocalStorageProvider(dir)), limits);
  app = createStorageApp(store, new HeaderAuthProvider(sql));
});

after(async () => {
  await sql.end();
  await rm(dir, { recursive: true, force: true });
});

async function upload(data: Uint8Array, filename: string) {
  const form = new FormData();
  form.set("file", new File([data as BlobPart], filename));
  return app.request("/assets", { method: "POST", body: form });
}

test("readGifInfo counts frames and treats sub-20ms delays as 100ms like browsers", () => {
  const info = readGifInfo(gif(8, 6, [50, 0, 200]));
  assert.deepEqual(info, { width: 8, height: 6, frameCount: 3, durationMs: 50 + 100 + 200 });
});

test("upload stores metadata from the bytes, ignoring the client filename extension", async () => {
  const res = await upload(png(300, 120), "not-really.gif");
  assert.equal(res.status, 201);
  const asset = (await res.json()) as Asset;
  assert.equal(asset.kind, "image");
  assert.equal(asset.mime, "image/png");
  assert.deepEqual([asset.width, asset.height], [300, 120]);

  const content = await app.request(asset.contentPath);
  assert.equal(content.headers.get("content-type"), "image/png");
  assert.equal((await content.arrayBuffer()).byteLength, asset.sizeBytes);
});

test("upload rejects media over the per-kind dimension and frame caps", async () => {
  const tooWide = await upload(png(301, 10), "a.png");
  assert.equal(tooWide.status, 422);
  assert.match(((await tooWide.json()) as { details: string[] }).details[0]!, /longest edge max is 300px/);

  assert.equal((await upload(gif(64, 64, [100, 100, 100]), "ok.gif")).status, 201);
  const tooManyFrames = await upload(gif(16, 16, [100, 100, 100, 100]), "long.gif");
  assert.equal(tooManyFrames.status, 422);
  assert.match(((await tooManyFrames.json()) as { details: string[] }).details[0]!, /4 frames, max is 3/);
});

test("upload rejects files over the byte cap and unknown types", async () => {
  const big = await upload(new Uint8Array(limits.maxBytes + 1), "big.bin");
  assert.equal(big.status, 413);
  assert.equal((await upload(new TextEncoder().encode("just some text, not media"), "x.txt")).status, 415);
});

test("content supports byte ranges", async () => {
  const asset = (await (await upload(png(10, 10), "r.png")).json()) as Asset;
  const res = await app.request(asset.contentPath, { headers: { range: "bytes=1-3" } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 1-3/${asset.sizeBytes}`);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0x50, 0x4e, 0x47]);
  const bad = await app.request(asset.contentPath, { headers: { range: `bytes=${asset.sizeBytes}-` } });
  assert.equal(bad.status, 416);
});
