/**
 * Seeds the starter content (scripts/starter/data.ts) into DATABASE_URL as the reserved `memegen` account; a no-op
 * once memegen has posted a meme. Needs the jacebrowning templates imported first (`SEED_TEMPLATES_FROM`). Meme
 * images are rendered by `scripts/render/render-memes.ts` before anything is written.
 *
 *   ./run.sh config/starter.env reset
 */
import { createSql, migrate, uploadLimitsFromEnv, type Sql } from "@memegen/server-kit";
import { assetStoreFromEnv, type AssetStore } from "@memegen/storage";
import { captionLayers, loadTemplates, renderAll, renderedFilename } from "../render/render-memes.ts";
import { STARTER_MEMES, STARTER_TAG } from "./data.ts";

async function isSeeded(sql: Sql): Promise<boolean> {
  const [row] = await sql`select 1 from memes m join users u on u.id = m.owner_id where lower(u.username) = 'memegen' limit 1`;
  return Boolean(row);
}

async function seedStarter(sql: Sql, store: AssetStore): Promise<void> {
  const templates = await loadTemplates(sql, STARTER_MEMES.map((m) => m.template));
  const layers = STARTER_MEMES.map((m) => captionLayers(templates.get(m.template)!, m.captions));
  const limits = uploadLimitsFromEnv();
  const images = await renderAll(
    sql,
    store,
    STARTER_MEMES.map((m, i) => {
      const t = templates.get(m.template)!;
      return { sourceAssetId: t.asset_id, kind: t.kind, layers: layers[i]!, limits };
    }),
    STARTER_MEMES.map((m) => m.title),
  );

  const [memegen] = await sql<{ owner: string }[]>`select memegen_user_id() as owner`;
  const owner = memegen!.owner;
  const [tag] = await sql<{ id: string }[]>`
    insert into tags (slug, name, kind, description)
    values (${STARTER_TAG.slug}, ${STARTER_TAG.name}, 'topic', ${STARTER_TAG.description})
    on conflict (slug) do update set slug = excluded.slug returning id`;
  for (const [i, m] of STARTER_MEMES.entries()) {
    const template = templates.get(m.template)!;
    const image = images[i]!;
    const output = await store.upload({ data: Buffer.from(image.base64, "base64"), filename: renderedFilename(m.title, image.extension), ownerId: owner });
    const at = new Date(Date.now() - m.ageHours * 3_600_000);
    const [meme] = await sql<{ id: string }[]>`
      insert into memes ${sql({
        owner_id: owner,
        template_id: template.id,
        source_asset_id: template.asset_id,
        output_asset_id: output.id,
        title: m.title,
        layers: sql.json(layers[i]! as never),
        visibility: "public",
        posted_at: at,
        created_at: at,
        updated_at: at,
      })} returning id`;
    await sql`insert into meme_tags (meme_id, tag_id) values (${meme!.id}, ${tag!.id})`;
  }
}

const sql = createSql();
try {
  await migrate(sql);
  if (await isSeeded(sql)) {
    console.log("starter content already present (memegen has posted memes); nothing to do");
  } else {
    await seedStarter(sql, assetStoreFromEnv(sql));
    console.log(`starter content seeded: ${STARTER_MEMES.length} memes by memegen`);
  }
} finally {
  await sql.end();
}
