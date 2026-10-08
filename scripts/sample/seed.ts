/**
 * Seeds the realistic dev dataset (scripts/sample/data.ts) into DATABASE_URL; a no-op if already seeded.
 * Needs the jacebrowning templates imported first (`SEED_TEMPLATES_FROM`). Meme images are rendered by
 * `scripts/render/render-memes.ts` (the client renderer in headless Chromium, offline).
 *
 *   bun run seed:sample
 */
import type { TextLayer } from "@memegen/shared";
import { createSql, migrate, uploadLimitsFromEnv, type Sql } from "@memegen/server-kit";
import { assetStoreFromEnv, type AssetStore } from "@memegen/storage";
import { captionLayers, loadTemplates, renderAll, renderedFilename, type TemplateRow } from "../render/render-memes.ts";
import { SAMPLE_MEMES, SAMPLE_TAGS, SAMPLE_USERS, type SampleMeme, type SampleUser } from "./data.ts";

async function isSeeded(sql: Sql): Promise<boolean> {
  const [row] = await sql`select 1 from users where lower(username) = ${SAMPLE_USERS[0]}`;
  return Boolean(row);
}

async function insertMeme(
  sql: Sql,
  m: SampleMeme,
  ids: { owner: string; template: TemplateRow; output: string; users: Map<SampleUser, string>; tags: Map<string, string> },
  layers: TextLayer[],
): Promise<void> {
  const at = new Date(Date.now() - m.ageHours * 3_600_000);
  const after = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
  const [row] = await sql<{ id: string }[]>`
    insert into memes ${sql({
      owner_id: ids.owner,
      template_id: ids.template.id,
      source_asset_id: ids.template.asset_id,
      output_asset_id: ids.output,
      title: m.title,
      layers: sql.json(layers as never),
      visibility: m.visibility ?? "public",
      posted_at: m.draft ? null : at,
      created_at: at,
      updated_at: at,
    })} returning id`;
  const memeId = row!.id;

  for (const slug of m.tags ?? []) {
    await sql`insert into meme_tags (meme_id, tag_id) values (${memeId}, ${ids.tags.get(slug)!})`;
  }
  const voters = SAMPLE_USERS.filter((u) => ids.users.get(u) !== ids.owner);
  if (m.up + m.down > voters.length) throw new Error(`${m.title}: ${m.up + m.down} votes but only ${voters.length} voters`);
  for (let i = 0; i < m.up + m.down; i++) {
    await sql`insert into votes (user_id, meme_id, value, created_at)
      values (${ids.users.get(voters[i]!)!}, ${memeId}, ${i < m.up ? 1 : -1}, ${after(5 + i * 7)})`;
  }
  for (const [i, user] of (m.favoritedBy ?? []).entries()) {
    await sql`insert into favorites (user_id, meme_id, created_at) values (${ids.users.get(user)!}, ${memeId}, ${after(10 + i * 11)})`;
  }
  for (const c of m.comments ?? []) {
    const [parent] = await sql<{ id: string }[]>`
      insert into comments (meme_id, author_id, body, created_at)
      values (${memeId}, ${ids.users.get(c.author)!}, ${c.body}, ${after(c.afterMinutes)}) returning id`;
    for (const r of c.replies ?? []) {
      await sql`insert into comments (meme_id, parent_id, author_id, body, created_at)
        values (${memeId}, ${parent!.id}, ${ids.users.get(r.author)!}, ${r.body}, ${after(r.afterMinutes)})`;
    }
  }
}

async function seedSample(sql: Sql, store: AssetStore): Promise<void> {
  const templates = await loadTemplates(sql, SAMPLE_MEMES.map((m) => m.template));
  const layers = SAMPLE_MEMES.map((m) => captionLayers(templates.get(m.template)!, m.captions));
  const limits = uploadLimitsFromEnv();
  // Render before writing anything, so a browser failure leaves the database untouched.
  const images = await renderAll(
    sql,
    store,
    SAMPLE_MEMES.map((m, i) => {
      const t = templates.get(m.template)!;
      return { sourceAssetId: t.asset_id, kind: t.kind, layers: layers[i]!, limits };
    }),
    SAMPLE_MEMES.map((m) => m.title),
  );

  const users = new Map<SampleUser, string>();
  for (const [i, username] of SAMPLE_USERS.entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into users (username, created_at) values (${username}, now() - ${`${500 - i * 20} days`}::interval) returning id`;
    users.set(username, row!.id);
  }
  const tags = new Map<string, string>();
  for (const t of SAMPLE_TAGS) {
    const [row] = await sql<{ id: string }[]>`
      insert into tags (slug, name, kind, description, created_by)
      values (${t.slug}, ${t.name}, 'topic', ${t.description}, ${users.get(t.createdBy)!})
      on conflict (slug) do update set slug = excluded.slug returning id`;
    tags.set(t.slug, row!.id);
  }
  for (const [i, m] of SAMPLE_MEMES.entries()) {
    const owner = users.get(m.owner)!;
    const image = images[i]!;
    const output = await store.upload({
      data: Buffer.from(image.base64, "base64"),
      filename: renderedFilename(m.title, image.extension),
      ownerId: owner,
    });
    await insertMeme(sql, m, { owner, template: templates.get(m.template)!, output: output.id, users, tags }, layers[i]!);
  }
}

const sql = createSql();
try {
  await migrate(sql);
  if (await isSeeded(sql)) {
    console.log(`sample data already present (user ${SAMPLE_USERS[0]} exists); nothing to do`);
  } else {
    await seedSample(sql, assetStoreFromEnv(sql));
    console.log(`sample data seeded: ${SAMPLE_USERS.length} users, ${SAMPLE_MEMES.length} memes`);
  }
} finally {
  await sql.end();
}
