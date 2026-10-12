/**
 * Imports every PNG in a folder as a built-in sticker (owned by `memegen`), named after its file
 * ("deal-with-it.png" → "Deal With It"). Dev seeding only (`SEED_STICKERS_FROM`, run by `run.sh seed`).
 *
 *   node scripts/seed-stickers.ts --from demo/stickers
 *
 * Idempotent: assets dedupe by sha256 and stickers by asset. Files that can't be stickers (over
 * `STICKER_MAX_DIMENSION`) are skipped with the reason.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { stickerViolations } from "@memegen/shared";
import { createSql, migrate } from "@memegen/server-kit";
import { assetStoreFromEnv } from "@memegen/storage";
import { titleCase } from "./lib.ts";

const { values } = parseArgs({ options: { from: { type: "string" } } });
if (!values.from) {
  console.error("usage: node scripts/seed-stickers.ts --from <folder of PNGs>");
  process.exit(1);
}
const ROOT = values.from;

async function main() {
  const sql = createSql();
  await migrate(sql);
  const store = assetStoreFromEnv(sql);
  const files = (await readdir(ROOT)).filter((f) => /\.png$/i.test(f)).sort();
  let created = 0;
  for (const file of files) {
    const name = titleCase(file.replace(/\.[^.]+$/, ""));
    const data = new Uint8Array(await readFile(join(ROOT, file)));
    const asset = await store.uploadOnce({ data, filename: file, name, ownerId: null });
    const violations = stickerViolations(asset);
    if (violations.length) {
      console.warn(`skip  ${file} — ${violations.join("; ")}`);
      continue;
    }
    // A null owner becomes the reserved `memegen` account (trigger), like built-in templates.
    const rows = await sql`
      insert into stickers ${sql({ name, asset_id: asset.id, owner_id: null })}
      on conflict (asset_id) do nothing returning id`;
    if (rows.length) created++;
    console.log(`sticker  ${name}`);
  }
  console.log(`stickers: ${created} created, ${files.length} files scanned`);
  await sql.end();
}

await main();
