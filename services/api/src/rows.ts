import type { Comment, Meme, Tag, Template, TextLayer } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";
import { toAsset, type AssetRow } from "@memegen/storage";

export interface MemeRow {
  id: string;
  title: string;
  owner_id: string;
  owner_username: string;
  template_id: string;
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
  favorited: boolean;
  tags: string[];
  comment_count: number;
}

/** Base select for memes as seen by `viewerId` (null = anonymous). Append where/order. */
export function memeSelect(sql: Sql, viewerId: string | null) {
  return sql`
    select m.id, m.title, m.owner_id, u.username as owner_username, m.template_id,
      row_to_json(sa.*) as source_asset, row_to_json(oa.*) as output_asset,
      m.layers, m.visibility, m.posted_at, m.created_at, m.updated_at,
      m.upvotes, m.downvotes, m.score, coalesce(v.value, 0)::int as my_vote,
      exists (select 1 from favorites f where f.meme_id = m.id and f.user_id = ${viewerId}) as favorited,
      array(select g.slug from meme_tags mt join tags g on g.id = mt.tag_id
        where mt.meme_id = m.id order by g.slug) as tags,
      (select count(*)::int from comments c where c.meme_id = m.id and c.deleted_at is null) as comment_count
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
    favorited: r.favorited,
    tags: r.tags,
    commentCount: r.comment_count,
  };
}

export interface TemplateRow {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string;
  owner_username: string;
  asset: AssetRow;
  default_layers: TextLayer[];
  is_public: boolean;
  created_at: Date;
  use_count: number;
  tags: string[];
  base_tags: string[];
}

export function templateSelect(sql: Sql) {
  return sql`
    select t.id, t.name, t.parent_id, t.owner_id, u.username as owner_username,
      row_to_json(a.*) as asset, t.default_layers, t.is_public, t.created_at,
      (select count(*)::int from template_uses u
        where u.kind = 'created'
          and (case when t.parent_id is null then u.root_template_id else u.template_id end) = t.id) as use_count,
      array(select g.slug from template_tags tt join tags g on g.id = tt.tag_id
        where tt.template_id = t.id order by g.slug) as tags,
      array(select g.slug from template_tags tt join tags g on g.id = tt.tag_id
        where tt.template_id = t.id and tt.base order by g.slug) as base_tags
    from templates t
    join assets a on a.id = t.asset_id
    join users u on u.id = t.owner_id`;
}

export function toTemplate(r: TemplateRow, variations: Template[] = []): Template {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    owner: { id: r.owner_id, username: r.owner_username },
    asset: toAsset(r.asset),
    defaultLayers: r.default_layers,
    isPublic: r.is_public,
    createdAt: r.created_at.toISOString(),
    variations,
    useCount: r.use_count,
    tags: r.tags,
    baseTags: r.base_tags,
  };
}

/**
 * Create missing slugs as `topic` tags named after the slug; existing tags (including team tags) are
 * reused. Idempotent, so it runs outside the tagging transaction.
 */
async function ensureTags(sql: Sql, slugs: readonly string[], userId: string): Promise<void> {
  await sql`
    insert into tags (slug, name, created_by)
    select s, s, ${userId} from unnest(${slugs as string[]}::text[]) as s
    on conflict (slug) do nothing`;
}

/** Replace the tags on a meme. */
export async function replaceMemeTags(sql: Sql, memeId: string, slugs: readonly string[], userId: string): Promise<void> {
  if (slugs.length) await ensureTags(sql, slugs, userId);
  await sql.begin(async (tx) => {
    await tx`delete from meme_tags where meme_id = ${memeId}`;
    if (slugs.length) {
      await tx`
        insert into meme_tags (meme_id, tag_id)
        select ${memeId}, id from tags where slug = any(${slugs as string[]}::text[])`;
    }
  });
}

/**
 * Add tags to a template. `base` tags come with the template from its author; others are community
 * additions. Tags already on the template are left as they are, so base tags stay base.
 */
export async function addTemplateTags(
  sql: Sql,
  templateId: string,
  slugs: readonly string[],
  userId: string,
  base: boolean,
): Promise<void> {
  if (!slugs.length) return;
  await ensureTags(sql, slugs, userId);
  await sql`
    insert into template_tags (template_id, tag_id, base, added_by)
    select ${templateId}, id, ${base}, ${userId} from tags where slug = any(${slugs as string[]}::text[])
    on conflict (template_id, tag_id) do nothing`;
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

export interface CommentRow {
  id: string;
  meme_id: string;
  parent_id: string | null;
  author_id: string;
  author_username: string;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
}

/** Base select for comments. Append where/order. */
export function commentSelect(sql: Sql) {
  return sql`
    select c.id, c.meme_id, c.parent_id, c.author_id, u.username as author_username,
      c.body, c.created_at, c.deleted_at
    from comments c
    join users u on u.id = c.author_id`;
}

export function toComment(r: CommentRow, replies: Comment[] = []): Comment {
  const deleted = r.deleted_at !== null;
  return {
    id: r.id,
    memeId: r.meme_id,
    parentId: r.parent_id,
    author: { id: r.author_id, username: r.author_username },
    body: deleted ? "" : r.body,
    deleted,
    createdAt: r.created_at.toISOString(),
    replies,
  };
}
