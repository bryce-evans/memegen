/**
 * Seeds the realistic dev dataset (scripts/sample/data.ts) into DATABASE_URL; a no-op if already seeded.
 * Needs the jacebrowning templates imported first (`SEED_TEMPLATES_FROM`). Meme images are rendered by
 * `scripts/render/render-memes.ts` (the client renderer in headless Chromium, offline).
 *
 *   ./run.sh config/dev.env seed   (with SEED_SAMPLE=true in the config)
 */
import type { Sql } from "@memegen/server-kit";
import type { AssetStore } from "@memegen/storage";
import { renderCaptioned, uploadRendered, type RenderedMeme } from "../render/render-memes.ts";
import { castVotes, insertMeme, runSeed, upsertTag } from "../lib.ts";
import { SAMPLE_MEMES, SAMPLE_TAGS, SAMPLE_USERS, type SampleMeme, type SampleUser } from "./data.ts";

async function isSeeded(sql: Sql): Promise<boolean> {
  const [row] = await sql`select 1 from users where lower(username) = ${SAMPLE_USERS[0]}`;
  return Boolean(row);
}

/** The meme plus its tags, votes, favorites, and comments. */
async function writeMeme(
  sql: Sql,
  m: SampleMeme,
  rendered: RenderedMeme,
  ids: { owner: string; output: string; users: Map<SampleUser, string>; tags: Map<string, string> },
): Promise<void> {
  const { id: memeId, at } = await insertMeme(sql, {
    ownerId: ids.owner,
    template: rendered.template,
    outputAssetId: ids.output,
    title: m.title,
    layers: rendered.layers,
    visibility: m.visibility,
    draft: m.draft,
    ageHours: m.ageHours,
  });
  const after = (minutes: number) => new Date(at.getTime() + minutes * 60_000);

  for (const slug of m.tags ?? []) {
    await sql`insert into meme_tags (meme_id, tag_id) values (${memeId}, ${ids.tags.get(slug)!})`;
  }
  const voterIds = SAMPLE_USERS.map((u) => ids.users.get(u)!).filter((id) => id !== ids.owner);
  await castVotes(sql, memeId, voterIds, { up: m.up, down: m.down, at: (i) => after(5 + i * 7) });
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
  // Render before writing anything, so a browser failure leaves the database untouched.
  const rendered = await renderCaptioned(sql, store, SAMPLE_MEMES);

  const users = new Map<SampleUser, string>();
  for (const [i, username] of SAMPLE_USERS.entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into users (username, created_at) values (${username}, now() - ${`${500 - i * 20} days`}::interval) returning id`;
    users.set(username, row!.id);
  }
  const tags = new Map<string, string>();
  for (const t of SAMPLE_TAGS) {
    tags.set(t.slug, await upsertTag(sql, { ...t, kind: "topic", createdBy: users.get(t.createdBy)! }));
  }
  for (const [i, m] of SAMPLE_MEMES.entries()) {
    const owner = users.get(m.owner)!;
    const output = await uploadRendered(store, rendered[i]!.image, m.title, owner);
    await writeMeme(sql, m, rendered[i]!, { owner, output: output.id, users, tags });
  }
}

await runSeed(isSeeded, seedSample, {
  present: `sample data already present (user ${SAMPLE_USERS[0]} exists); nothing to do`,
  seeded: `sample data seeded: ${SAMPLE_USERS.length} users, ${SAMPLE_MEMES.length} memes`,
});
