/** SQL shared by the seed scripts (scripts/seed.ts, scripts/mock/seed-data.ts). */
import type { TextLayer } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";

export interface TemplateInsert {
  slug: string;
  name: string;
  assetId: string;
  layers: TextLayer[];
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
