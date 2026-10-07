import type { Comment, Layer, Meme, Panel, PanelLayout, PanelSet, Period, Tag, Template, TemplateKind, Visibility } from "@memegen/shared";
import { HttpError, toAsset, type AssetRow, type Sql } from "@memegen/server-kit";

// ---- shared SQL pieces -------------------------------------------------------------

/**
 * Visibility rules, written once. Fragments use the aliases `m` (memes) and `t` (templates).
 * Listed = posted and public: galleries, public profiles, tag counts, votes, favorites, and comments.
 */
export function memeListed(sql: Sql) {
  return sql`(m.visibility = 'public' and m.posted_at is not null)`;
}

/** Listed memes plus the viewer's own (drafts and private included). */
export function memeVisibleTo(sql: Sql, viewerId: string | null) {
  return sql`(${memeListed(sql)} or m.owner_id = ${viewerId})`;
}

/** Opening one meme by id: anything public (drafts too, so links work before posting) plus the viewer's own. */
export function memeOpenTo(sql: Sql, viewerId: string | null) {
  return sql`(m.visibility = 'public' or m.owner_id = ${viewerId})`;
}

export function templateVisibleTo(sql: Sql, viewerId: string | null) {
  return sql`(t.is_public or t.owner_id = ${viewerId})`;
}

/** JS twin of `memeListed` for a loaded row: only listed memes take votes, favorites, and comments. */
export function requireListed(meme: MemeRow, action: string): void {
  if (meme.visibility !== "public" || !meme.posted_at) {
    throw new HttpError(400, `only posted public memes can be ${action}`);
  }
}

/** `ilike` pattern matching `q` anywhere, with LIKE wildcards in `q` taken literally. */
export function containsPattern(q: string): string {
  return "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
}

const PERIOD_INTERVAL: Record<Exclude<Period, "all">, string> = {
  day: "1 day",
  week: "7 days",
  month: "1 month",
  year: "1 year",
};

/** Start of a bounded period, counted back from now. */
export function periodStart(sql: Sql, period: Exclude<Period, "all">) {
  return sql`now() - ${PERIOD_INTERVAL[period]}::interval`;
}

/** Pair each parent with its children (rows whose `parent_id` is the parent's id), keeping both orders. */
export function nest<R extends { id: string; parent_id: string | null }, T>(
  parents: readonly R[],
  children: readonly R[],
  map: (parent: R, children: R[]) => T,
): T[] {
  const byParent = Map.groupBy(children, (c) => c.parent_id);
  return parents.map((p) => map(p, byParent.get(p.id) ?? []));
}

// ---- memes -------------------------------------------------------------------------

export interface MemeRow {
  id: string;
  title: string;
  owner_id: string;
  owner_username: string;
  template_id: string;
  source_asset: AssetRow;
  output_asset: AssetRow;
  layers: Layer[];
  panels: PanelSet | null;
  visibility: Visibility;
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

/**
 * Base select for memes as seen by `viewerId` (null = anonymous). Callers append joins, where, and
 * order, and may rely on the aliases `m` (memes), `u` (owner), and `v` (the viewer's vote; its
 * columns are null when they haven't voted).
 */
export function memeSelect(sql: Sql, viewerId: string | null) {
  return sql`
    select m.id, m.title, m.owner_id, u.username as owner_username, m.template_id,
      row_to_json(sa.*) as source_asset, row_to_json(oa.*) as output_asset,
      m.layers, m.panels, m.visibility, m.posted_at, m.created_at, m.updated_at,
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
    panels: r.panels,
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

// ---- templates ---------------------------------------------------------------------

export interface TemplateRow {
  id: string;
  name: string;
  parent_id: string | null;
  kind: TemplateKind;
  owner_id: string;
  owner_username: string;
  asset: AssetRow;
  default_layers: Layer[];
  /** Pack lives in `template_pack_assets`, selected as `pack`. */
  panels: { layout: PanelLayout; grid: boolean; fontSize: number; defaultPanels: Panel[] } | null;
  /** Pack assets in order; null for single-media templates. */
  pack: AssetRow[] | null;
  is_public: boolean;
  created_at: Date;
  use_count: number;
  tags: string[];
  base_tags: string[];
}

/** Base select for templates (alias `t`). Append where/order. */
export function templateSelect(sql: Sql) {
  return sql`
    select t.id, t.name, t.parent_id, t.kind, t.owner_id, u.username as owner_username,
      row_to_json(a.*) as asset, t.default_layers, t.is_public, t.created_at, t.panels,
      (select json_agg(row_to_json(pa.*) order by tp.position) from template_pack_assets tp
        join assets pa on pa.id = tp.asset_id
        where tp.template_id = t.id and t.panels is not null) as pack,
      (select count(*)::int from template_uses tu
        where tu.kind = 'created'
          and (case when t.parent_id is null then tu.root_template_id else tu.template_id end) = t.id) as use_count,
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
    kind: r.kind,
    owner: { id: r.owner_id, username: r.owner_username },
    asset: toAsset(r.asset),
    defaultLayers: r.default_layers,
    panels: r.panels
      ? {
          layout: r.panels.layout,
          grid: r.panels.grid,
          fontSize: r.panels.fontSize,
          pack: (r.pack ?? []).map(toAsset),
          defaultPanels: r.panels.defaultPanels,
        }
      : null,
    isPublic: r.is_public,
    createdAt: r.created_at.toISOString(),
    variations,
    useCount: r.use_count,
    tags: r.tags,
    baseTags: r.base_tags,
  };
}

/** Templates in input order, each top-level one with the variations `viewerId` can see (one query). */
export async function withVariations(sql: Sql, rows: readonly TemplateRow[], viewerId: string | null): Promise<Template[]> {
  const parentIds = rows.filter((r) => r.parent_id === null).map((r) => r.id);
  const variations = parentIds.length
    ? await sql<TemplateRow[]>`${templateSelect(sql)}
        where t.parent_id in ${sql(parentIds)} and ${templateVisibleTo(sql, viewerId)}
        order by t.created_at, t.id`
    : [];
  return nest(rows, variations, (r, vs) => toTemplate(r, vs.map((v) => toTemplate(v))));
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

// ---- tags --------------------------------------------------------------------------

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
        where x.tag_id = g.id and ${templateVisibleTo(sql, viewerId)}) as template_count,
      (select count(*)::int from meme_tag_matches x join memes m on m.id = x.meme_id
        where x.tag_id = g.id and ${memeListed(sql)}) as meme_count
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

// ---- comments ----------------------------------------------------------------------

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

/** Base select for comments (alias `c`). Append where/order. */
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
