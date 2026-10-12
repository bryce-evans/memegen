/**
 * SQL and helpers shared by the seed scripts (scripts/seed.ts, scripts/seed-stickers.ts, scripts/mock/seed-data.ts,
 * scripts/sample/seed.ts, scripts/starter/seed.ts) and file naming shared with scripts/snapshot.
 */
import type { Layer, TagKind, Visibility } from "@memegen/shared";
import { createSql, migrate, type Sql } from "@memegen/server-kit";
import { assetStoreFromEnv, type AssetStore } from "@memegen/storage";

export interface TemplateInsert {
  slug: string;
  name: string;
  assetId: string;
  layers: Layer[];
  parentId?: string | null;
  /** null: the reserved `memegen` account (filled in by a trigger). */
  ownerId?: string | null;
  createdAt?: Date;
}

/** Inserts a public template and returns its id. */
export async function insertTemplate(sql: Sql, t: TemplateInsert): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into templates ${sql({
      slug: t.slug,
      name: t.name,
      asset_id: t.assetId,
      parent_id: t.parentId ?? null,
      owner_id: t.ownerId ?? null,
      default_layers: sql.json(t.layers as never),
      created_at: t.createdAt ?? new Date(),
    })} returning id`;
  return row!.id;
}

/** Tags a template with existing tags by slug; unknown slugs and tags it already has are skipped. */
export async function tagTemplate(sql: Sql, templateId: string, slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) return;
  await sql`
    insert into template_tags (template_id, tag_id)
    select ${templateId}, id from tags where slug in ${sql([...slugs])}
    on conflict do nothing`;
}

export interface MemeInsert {
  ownerId: string;
  template: { id: string; assetId: string };
  outputAssetId: string;
  title: string;
  layers: Layer[];
  visibility?: Visibility;
  draft?: boolean;
  /** Posted (and created) this many hours before seeding. */
  ageHours: number;
}

/** Inserts a meme made from `template` (its asset is the source); returns its id and when it was posted. */
export async function insertMeme(sql: Sql, m: MemeInsert): Promise<{ id: string; at: Date }> {
  const at = new Date(Date.now() - m.ageHours * 3_600_000);
  const [row] = await sql<{ id: string }[]>`
    insert into memes ${sql({
      owner_id: m.ownerId,
      template_id: m.template.id,
      source_asset_id: m.template.assetId,
      output_asset_id: m.outputAssetId,
      title: m.title,
      layers: sql.json(m.layers as never),
      visibility: m.visibility ?? "public",
      posted_at: m.draft ? null : at,
      created_at: at,
      updated_at: at,
    })} returning id`;
  return { id: row!.id, at };
}

/** The first `up` voters upvote the meme, the next `down` downvote it; vote `i` is cast at `at(i)`. */
export async function castVotes(
  sql: Sql,
  memeId: string,
  voterIds: readonly string[],
  votes: { up: number; down: number; at: (i: number) => Date },
): Promise<void> {
  const count = votes.up + votes.down;
  if (count > voterIds.length) throw new Error(`meme ${memeId}: ${count} votes but only ${voterIds.length} voters`);
  for (let i = 0; i < count; i++) {
    await sql`insert into votes (user_id, meme_id, value, created_at)
      values (${voterIds[i]!}, ${memeId}, ${i < votes.up ? 1 : -1}, ${votes.at(i)})`;
  }
}

/** Creates the tag, or finds it when the slug exists; returns its id. `createdBy` null: no creator. */
export async function upsertTag(
  sql: Sql,
  t: { slug: string; name: string; kind: TagKind; description: string; createdBy: string | null },
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into tags (slug, name, kind, description, created_by)
    values (${t.slug}, ${t.name}, ${t.kind}, ${t.description}, ${t.createdBy})
    on conflict (slug) do update set slug = excluded.slug returning id`;
  return row!.id;
}

/** Migrates DATABASE_URL, then runs `seed` unless `isSeeded` says the data is already there; logs which. */
export async function runSeed(
  isSeeded: (sql: Sql) => Promise<boolean>,
  seed: (sql: Sql, store: AssetStore) => Promise<void>,
  log: { present: string; seeded: string },
): Promise<void> {
  const sql = createSql();
  try {
    await migrate(sql);
    if (await isSeeded(sql)) {
      console.log(log.present);
    } else {
      await seed(sql, assetStoreFromEnv(sql));
      console.log(log.seeded);
    }
  } finally {
    await sql.end();
  }
}

/** `Distracted Boyfriend!` → `distracted-boyfriend`, at most 60 characters. */
export function fileSlug(label: string): string {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

/** "deal-with-it" → "Deal With It": display names from file and folder names. */
export function titleCase(stem: string): string {
  return stem.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
