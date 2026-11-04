/**
 * Resets the e2e database and storage, then seeds one font and the mock dataset (e2e/mock).
 * Run by Playwright's global setup through Node (type stripping), never against the dev DB.
 */
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { assertDisposableDatabase } from "@memegen/server-kit/testing";
import { createSql, migrate } from "@memegen/server-kit";
import { assetStoreFromEnv } from "@memegen/storage";
import { seedMockData } from "./mock/seed-data.ts";

const url = process.env.DATABASE_URL ?? "";
const mainUrl = process.env.E2E_MAIN_DATABASE_URL;
if (!mainUrl) throw new Error("e2e setup requires the main database URL for separation checks");
assertDisposableDatabase(url, "e2e", { ...process.env, DATABASE_URL: mainUrl });
const storageDir = process.env.LOCAL_STORAGE_DIR ?? "";
if (process.env.STORAGE_PROVIDER !== "local" || resolve(storageDir) !== resolve(".data/e2e-storage") ||
    resolve(storageDir) === resolve(process.env.E2E_MAIN_STORAGE_DIR ?? ".data/storage")) {
  throw new Error("refusing to reset storage outside the dedicated e2e directory or shared with the main stack");
}

await rm(storageDir, { recursive: true, force: true });
const sql = createSql(url);
try {
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
  await migrate(sql);
  const store = assetStoreFromEnv(sql);
  const font = new Uint8Array(await readFile(new URL("./fixtures/TitilliumWeb-Black.ttf", import.meta.url)));
  await store.upload({ data: font, filename: "TitilliumWeb-Black.ttf", name: "Titillium Web Black", ownerId: null });
  await seedMockData(sql, store);
} finally {
  await sql.end();
}
