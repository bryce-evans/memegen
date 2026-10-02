/**
 * Resets the e2e database and storage, then seeds one font and the built-in tags.
 * Run by Playwright's global setup through Node (type stripping), never against the dev DB.
 */
import { readFile, rm } from "node:fs/promises";
import { createSql, migrate, uploadLimitsFromEnv } from "@memegen/server-kit";
import { AssetStore, LocalStorageProvider, staticProviders } from "@memegen/storage";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("e2e")) throw new Error(`refusing to reset a non-e2e database: ${url}`);
const storageDir = process.env.LOCAL_STORAGE_DIR ?? ".data/e2e-storage";

await rm(storageDir, { recursive: true, force: true });
const sql = createSql(url);
try {
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
  await migrate(sql);
  const store = new AssetStore(sql, staticProviders(new LocalStorageProvider(storageDir)), uploadLimitsFromEnv());
  const font = new Uint8Array(await readFile(new URL("./fixtures/TitilliumWeb-Black.ttf", import.meta.url)));
  await store.upload({ data: font, filename: "TitilliumWeb-Black.ttf", name: "Titillium Web Black", ownerId: null });
} finally {
  await sql.end();
}
