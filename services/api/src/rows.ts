import type { Meme, Tag, Template, TextLayer } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";
import { toAsset, type AssetRow } from "@memegen/storage";

export interface MemeRow {
  id: string;
  title: string;
  owner_id: string;
  owner_username: string;
  template_id: string | null;
  source_asset: AssetRow;
  output_asset: AssetRow;
  layers: TextLayer[];
  visibility: "public" | "private";
  posted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  upvotes: number;
  downvotes: number;
  score: number;
  my_vote: number;
  tags: string[];
}

/** Base select for memes as seen by `viewerId` (null = anonymous). Append where/order. */
export function memeSelect(sql: Sql, viewerId: string | null) {
  return sql`
    select m.id, m.title, m.owner_id, u.username as owner_username, m.template_id,
      row_to_json(sa.*) as source_asset, row_to_json(oa.*) as output_asset,
      m.layers, m.visibility, m.posted_at, m.created_at, m.updated_at,
      m.upvotes, m.downvotes, m.score, coalesce(v.value, 0)::int as my_vote,
      array(select g.slug from meme_tags mt join tags g on g.id = mt.tag_id
        where mt.meme_id = m.id order by g.slug) as tags
    from memes m
    join users u on u.id = m.owner_id
    join assets sa on sa.id = m.source_asset_id
    join assets oa on oa.id = m.output_asset_id
    left join votes v on v.meme_id = m.id and v.user_id = ${viewerId}`;
}

export function toMeme(r: MemeRow): Meme {
  return {
    id: r.id,
    title: r.title,
    owner: { id: r.owner_id, username: r.owner_username },
    templateId: r.template_id,
    sourceAsset: toAsset(r.source_asset),
    outputAsset: toAsset(r.output_asset),
    layers: r.layers,
    visibility: r.visibility,
    postedAt: r.posted_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    upvotes: r.upvotes,
    downvotes: r.downvotes,
    score: r.score,
    myVote: r.my_vote,
    tags: r.tags,
  };
}

export interface TemplateRow {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string | null;
  owner_username: string | null;
  asset: AssetRow;
  default_layers: TextLayer[];
  is_public: boolean;
  created_at: Date;
  use_count: number;
  tags: string[];
}

export function templateSelect(sql: Sql) {
  return sql`
    select t.id, t.name, t.parent_id, t.owner_id, u.username as owner_username,
      row_to_json(a.*) as asset, t.default_layers, t.is_public, t.created_at,
      (select count(*)::int from template_uses u
        where u.kind = 'created'
          and (case when t.parent_id is null then u.root_template_id else u.template_id end) = t.id) as use_count,
      array(select g.slug from template_tags tt join tags g on g.id = tt.tag_id
        where tt.template_id = t.id order by g.slug) as tags
    from templates t
    join assets a on a.id = t.asset_id
    left join users u on u.id = t.owner_id`;
}

export function toTemplate(r: TemplateRow, variations: Template[] = []): Template {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    owner: r.owner_id ? { id: r.owner_id, username: r.owner_username! } : null,
    asset: toAsset(r.asset),
    defaultLayers: r.default_layers,
    isPublic: r.is_public,
    createdAt: r.created_at.toISOString(),
    variations,
    useCount: r.use_count,
    tags: r.tags,
  };
}

/**
 * Replace the tags on a template or meme. Unknown slugs become `topic` tags
 * named after the slug; existing tags (including team tags) are reused.
 */
export async function replaceTags(
  sql: Sql,
  target: { table: "template_tags"; id: string } | { table: "meme_tags"; id: string },
  slugs: readonly string[],
  userId: string,
): Promise<void> {
  const column = target.table === "template_tags" ? sql`template_id` : sql`meme_id`;
  await sql.begin(async (tx) => {
    if (slugs.length) {
      await tx`
        insert into tags (slug, name, created_by)
        select s, s, ${userId} from unnest(${slugs as string[]}::text[]) as s
        on conflict (slug) do nothing`;
    }
    await tx`delete from ${tx(target.table)} where ${column} = ${target.id}`;
    if (slugs.length) {
      await tx`
        insert into ${tx(target.table)} (${column}, tag_id)
        select ${target.id}, id from tags where slug = any(${slugs as string[]}::text[])`;
    }
  });
}

export interface TagRow {
  slug: string;
  name: string;
  kind: "topic" | "team";
  description: string;
  template_count: number;
  meme_count: number;
}

/** Tags with counts of what a tag search would return for `viewerId`. Append where/order. */
export function tagSelect(sql: Sql, viewerId: string | null) {
  return sql`
    select g.slug, g.name, g.kind, g.description,
      (select count(*)::int from template_tag_matches x join templates t on t.id = x.template_id
        where x.tag_id = g.id and (t.is_public or t.owner_id = ${viewerId})) as template_count,
      (select count(*)::int from meme_tag_matches x join memes m on m.id = x.meme_id
        where x.tag_id = g.id and m.visibility = 'public' and m.posted_at is not null) as meme_count
    from tags g`;
}

export function toTag(r: TagRow): Tag {
  return {
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    description: r.description,
    templateCount: r.template_count,
    memeCount: r.meme_count,
  };
}
