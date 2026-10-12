/**
 * Seeds the starter content (scripts/starter/data.ts) into DATABASE_URL as the reserved `memegen` account; a no-op
 * once memegen has posted a meme. Needs the jacebrowning templates imported first (`SEED_TEMPLATES_FROM`). Meme
 * images are rendered by `scripts/render/render-memes.ts` before anything is written.
 *
 *   ./run.sh config/starter.env reset
 */
import type { Sql } from "@memegen/server-kit";
import type { AssetStore } from "@memegen/storage";
import { renderCaptioned, uploadRendered } from "../render/render-memes.ts";
import { insertMeme, runSeed, upsertTag } from "../lib.ts";
import { STARTER_MEMES, STARTER_TAG } from "./data.ts";

async function isSeeded(sql: Sql): Promise<boolean> {
  const [row] = await sql`select 1 from memes m join users u on u.id = m.owner_id where lower(u.username) = 'memegen' limit 1`;
  return Boolean(row);
}

async function seedStarter(sql: Sql, store: AssetStore): Promise<void> {
  const rendered = await renderCaptioned(sql, store, STARTER_MEMES);

  const [memegen] = await sql<{ owner: string }[]>`select memegen_user_id() as owner`;
  const owner = memegen!.owner;
  const tagId = await upsertTag(sql, { ...STARTER_TAG, kind: "topic", createdBy: null });
  for (const [i, m] of STARTER_MEMES.entries()) {
    const { template, layers, image } = rendered[i]!;
    const output = await uploadRendered(store, image, m.title, owner);
    const { id } = await insertMeme(sql, { ownerId: owner, template, outputAssetId: output.id, title: m.title, layers, ageHours: m.ageHours });
    await sql`insert into meme_tags (meme_id, tag_id) values (${id}, ${tagId})`;
  }
}

await runSeed(isSeeded, seedStarter, {
  present: "starter content already present (memegen has posted memes); nothing to do",
  seeded: `starter content seeded: ${STARTER_MEMES.length} memes by memegen`,
});
