/**
 * Resets the e2e database and storage, then seeds one font and the mock dataset (scripts/mock).
 * Run by Playwright's global setup through Node (type stripping), never against the dev DB.
 */
import { readFile, rm } from "node:fs/promises";
import { createSql, migrate } from "@memegen/server-kit";
import { assetStoreFromEnv } from "@memegen/storage";
import { seedMockData } from "../scripts/mock/seed-data.ts";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("e2e")) throw new Error(`refusing to reset a non-e2e database: ${url}`);
const storageDir = process.env.LOCAL_STORAGE_DIR ?? "";
if (process.env.STORAGE_PROVIDER !== "local" || !storageDir.includes("e2e")) {
  throw new Error(`refusing to reset non-e2e storage: ${process.env.STORAGE_PROVIDER} ${storageDir}`);
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
