import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  createCommentSchema,
  createMemeSchema,
  createTagSchema,
  createTemplateSchema,
  galleryQuerySchema,
  hotTemplatesQuerySchema,
  favoriteSchema,
  leaderboardQuerySchema,
  sessionSchema,
  setTagsSchema,
  tagSlug,
  tagSlugSchema,
  tagsQuerySchema,
  templateUsageQuerySchema,
  updateMemeSchema,
  updateTemplateSchema,
  voteSchema,
  type HotTemplate,
  type Page,
  type Period,
  type Template,
  type TemplateUsage,
  type User,
  type UserProfile,
} from "@memegen/shared";
import {
  HttpError,
  installErrorHandler,
  parse,
  parseJson,
  requireInternal,
  type AuthProvider,
  type Sql,
} from "@memegen/server-kit";
import { findAssetRow } from "@memegen/storage";
import {
  addTemplateTags,
  commentSelect,
  memeSelect,
  replaceMemeTags,
  tagSelect,
  templateSelect,
  toComment,
  toMeme,
  toTag,
  toTemplate,
  type CommentRow,
  type MemeRow,
  type TagRow,
  type TemplateRow,
} from "./rows.ts";
import { leaderboard, publicStats, userStats } from "./stats.ts";

const idParam = z.object({ id: z.uuid() });
const pageQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
const commentsQuery = pageQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const templateQuery = pageQuery.extend({
  q: z.string().trim().max(100).default(""),
  tag: tagSlugSchema.optional(),
});

const PERIOD_INTERVAL: Record<Exclude<Period, "all">, string> = {
  day: "1 day",
  week: "7 days",
  month: "1 month",
  year: "1 year",
};

/** Time-series granularity for each period. */
const PERIOD_BUCKET: Record<Period, TemplateUsage["bucket"]> = {
  day: "hour",
  week: "day",
  month: "day",
  year: "month",
  all: "month",
};

type Env = { Variables: { user: User | null } };
export type ApiApp = Hono<Env>;

function page<T>(rows: T[], offset: number, limit: number): Page<T> {
  return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
}

export function createApiApp(sql: Sql, auth: AuthProvider): ApiApp {
  const app = new Hono<Env>();
  installErrorHandler(app);

  app.use("*", async (c, next) => {
    c.set("user", await auth.resolve(c));
    await next();
  });

  const requireUser = (c: Context<Env>): User => {
    const user = c.get("user");
    if (!user) throw new HttpError(401, "sign in first (X-User-Id)");
    return user;
  };

  const findUserByName = async (username: string): Promise<User> => {
    const [row] = await sql<{ id: string; username: string; created_at: Date }[]>`
      select id, username, created_at from users where lower(username) = lower(${username})`;
    if (!row) throw new HttpError(404, "user not found");
    return { id: row.id, username: row.username, createdAt: row.created_at.toISOString() };
  };

  const loadMeme = async (id: string, viewer: User | null) => {
    const [row] = await sql<MemeRow[]>`${memeSelect(sql, viewer?.id ?? null)} where m.id = ${id}`;
    if (!row || (row.visibility === "private" && row.owner_id !== viewer?.id)) {
      throw new HttpError(404, "meme not found");
    }
    return row;
  };

  const loadTemplate = async (id: string, viewer: User | null): Promise<Template> => {
    const viewerId = viewer?.id ?? null;
    const [row] = await sql<TemplateRow[]>`${templateSelect(sql)} where t.id = ${id}
      and (t.is_public or t.owner_id = ${viewerId})`;
    if (!row) throw new HttpError(404, "template not found");
    const variations = row.parent_id
      ? []
      : await sql<TemplateRow[]>`${templateSelect(sql)} where t.parent_id = ${id}
          and (t.is_public or t.owner_id = ${viewerId}) order by t.created_at, t.id`;
    return toTemplate(row, variations.map((v) => toTemplate(v)));
  };

  const requireMediaAsset = async (id: string, label: string) => {
    const asset = await findAssetRow(sql, id);
    if (!asset) throw new HttpError(400, `${label} does not exist`);
    if (asset.kind === "font") throw new HttpError(400, `${label} must be an image, gif, or video`);
    return asset;
  };

  // ---- session / users -------------------------------------------------------

  /** DEV login: find-or-create by username. Replace with a real AuthProvider flow. */
  app.post("/api/session", async (c) => {
    const { username } = await parseJson(c, sessionSchema);
    const [row] = await sql<{ id: string; username: string; created_at: Date }[]>`
      with ins as (
        insert into users (username) values (${username})
        on conflict (lower(username)) do nothing
        returning id, username, created_at
      )
      select * from ins
      union all
      select id, username, created_at from users where lower(username) = lower(${username})
      limit 1`;
    const user: User = { id: row!.id, username: row!.username, createdAt: row!.created_at.toISOString() };
    return c.json({ user });
  });

  /** Public stats plus how many public templates (variations included) the user added. */
  const profile = async (user: User): Promise<UserProfile> => {
    const [stats, [count]] = await Promise.all([
      userStats(sql, user.id),
      sql<{ n: number }[]>`select count(*)::int as n from templates where owner_id = ${user.id} and is_public`,
    ]);
    return { user, stats: publicStats(stats), templateCount: count!.n };
  };

  app.get("/api/me", async (c) => {
    return c.json(await profile(requireUser(c)));
  });

  app.get("/api/users/:username", async (c) => {
    return c.json(await profile(await findUserByName(c.req.param("username"))));
  });

  app.get("/api/users/:username/memes", async (c) => {
    const owner = await findUserByName(c.req.param("username"));
    const { offset, limit } = parse(pageQuery, c.req.query());
    const viewer = c.get("user");
    const isOwner = viewer?.id === owner.id;
    const rows = await sql<MemeRow[]>`${memeSelect(sql, viewer?.id ?? null)}
      where m.owner_id = ${owner.id}
      ${isOwner ? sql`` : sql`and m.visibility = 'public' and m.posted_at is not null`}
      order by coalesce(m.posted_at, m.created_at) desc, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });

  app.get("/internal/users/:username/stats", async (c) => {
    requireInternal(c);
    const user = await findUserByName(c.req.param("username"));
    return c.json(await userStats(sql, user.id));
  });

  app.get("/api/leaderboard", async (c) => {
    const { by, limit } = parse(leaderboardQuerySchema, c.req.query());
    return c.json(await leaderboard(sql, by, limit));
  });

  /** Recent activity: every meme the signed-in user voted on (`myVote` says which way) that they can still see, newest vote first. */
  app.get("/api/me/activity", async (c) => {
    const user = requireUser(c);
    const { offset, limit } = parse(pageQuery, c.req.query());
    const rows = await sql<MemeRow[]>`${memeSelect(sql, user.id)}
      where v.user_id is not null
        and ((m.visibility = 'public' and m.posted_at is not null) or m.owner_id = ${user.id})
      order by v.created_at desc, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });

  /** The signed-in user's starred memes that they can still see, most recently starred first. */
  app.get("/api/me/favorites", async (c) => {
    const user = requireUser(c);
    const { offset, limit } = parse(pageQuery, c.req.query());
    const rows = await sql<MemeRow[]>`${memeSelect(sql, user.id)}
      join favorites f on f.meme_id = m.id and f.user_id = ${user.id}
      where (m.visibility = 'public' and m.posted_at is not null) or m.owner_id = ${user.id}
      order by f.created_at desc, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });

  // ---- templates -------------------------------------------------------------

  app.get("/api/templates", async (c) => {
    const { q, tag, offset, limit } = parse(templateQuery, c.req.query());
    const viewerId = c.get("user")?.id ?? null;
    const visible = sql`(t.is_public or t.owner_id = ${viewerId})`;
    const parents = await sql<TemplateRow[]>`${templateSelect(sql)}
      where t.parent_id is null and ${visible}
      ${q ? sql`and t.name ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"}` : sql``}
      ${tag ? sql`and exists (select 1 from template_tag_matches x join tags g on g.id = x.tag_id
        where x.template_id = t.id and g.slug = ${tag})` : sql``}
      order by lower(t.name), t.id
      offset ${offset} limit ${limit + 1}`;
    const { items: shown, nextOffset } = page(parents, offset, limit);
    const children = shown.length
      ? await sql<TemplateRow[]>`${templateSelect(sql)}
          where t.parent_id in ${sql(shown.map((p) => p.id))} and ${visible}
          order by t.created_at, t.id`
      : [];
    const byParent = Map.groupBy(children, (v) => v.parent_id!);
    const items = shown.map((p) => toTemplate(p, (byParent.get(p.id) ?? []).map((v) => toTemplate(v))));
    return c.json({ items, nextOffset });
  });

  /** Most-used top-level templates in the period; variation uses roll up into their parent. */
  app.get("/api/templates/hot", async (c) => {
    const { period, limit } = parse(hotTemplatesQuerySchema, c.req.query());
    const viewer = c.get("user");
    const since = period === "all" ? sql`` : sql`and u.created_at >= now() - ${PERIOD_INTERVAL[period]}::interval`;
    const ranked = await sql<{ id: string; uses: number; posts: number }[]>`
      select u.root_template_id as id,
        count(*) filter (where u.kind = 'created')::int as uses,
        count(*) filter (where u.kind = 'posted')::int as posts
      from template_uses u
      join templates t on t.id = u.root_template_id
      where (t.is_public or t.owner_id = ${viewer?.id ?? null}) ${since}
      group by u.root_template_id
      order by uses desc, posts desc, u.root_template_id
      limit ${limit}`;
    const items: HotTemplate[] = [];
    for (const r of ranked) {
      items.push({ template: await loadTemplate(r.id, viewer), uses: r.uses, posts: r.posts });
    }
    return c.json(items);
  });

  /** Zero-filled usage time series for one template (top-level includes its variations). */
  app.get("/api/templates/:id/usage", async (c) => {
    const { id } = parse(idParam, c.req.param());
    const { period } = parse(templateUsageQuerySchema, c.req.query());
    const template = await loadTemplate(id, c.get("user"));
    const bucket = PERIOD_BUCKET[period];
    const match = template.parentId ? sql`u.template_id = ${id}` : sql`u.root_template_id = ${id}`;
    const start =
      period === "all"
        ? sql`coalesce((select min(u.created_at) from template_uses u where ${match}), now())`
        : sql`now() - ${PERIOD_INTERVAL[period]}::interval`;
    const points = await sql<{ at: Date; uses: number; posts: number }[]>`
      with buckets as (
        select generate_series(date_trunc(${bucket}, ${start}), date_trunc(${bucket}, now()), ${"1 " + bucket}::interval) as at
      )
      select b.at,
        count(u.*) filter (where u.kind = 'created')::int as uses,
        count(u.*) filter (where u.kind = 'posted')::int as posts
      from buckets b
      left join template_uses u on ${match} and date_trunc(${bucket}, u.created_at) = b.at
      group by b.at order by b.at`;
    const usage: TemplateUsage = {
      templateId: id,
      period,
      bucket,
      points: points.map((p) => ({ at: p.at.toISOString(), uses: p.uses, posts: p.posts })),
    };
    return c.json(usage);
  });

  app.get("/api/templates/:id", async (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(await loadTemplate(id, c.get("user")));
  });

  app.post("/api/templates", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createTemplateSchema);
    await requireMediaAsset(body.assetId, "assetId");
    if (body.parentId) {
      const [parent] = await sql<{ parent_id: string | null }[]>`
        select parent_id from templates where id = ${body.parentId} and (is_public or owner_id = ${user.id})`;
      if (!parent) throw new HttpError(400, "parent template does not exist");
      if (parent.parent_id) throw new HttpError(400, "variations cannot have variations; use the top-level template");
    }
    const [row] = await sql<{ id: string }[]>`
      insert into templates ${sql({
        name: body.name,
        asset_id: body.assetId,
        parent_id: body.parentId ?? null,
        owner_id: user.id,
        default_layers: sql.json(body.defaultLayers as never),
        is_public: body.isPublic,
      })} returning id`;
    await addTemplateTags(sql, row!.id, body.tags, user.id, true);
    return c.json(await loadTemplate(row!.id, user), 201);
  });

  const ownTemplate = async (c: Context<Env>) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const [row] = await sql<{ owner_id: string }[]>`select owner_id from templates where id = ${id}`;
    if (!row) throw new HttpError(404, "template not found");
    if (row.owner_id !== user.id) throw new HttpError(403, "only the owner can change this template");
    return { user, id };
  };

  app.patch("/api/templates/:id", async (c) => {
    const { user, id } = await ownTemplate(c);
    const body = await parseJson(c, updateTemplateSchema);
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.isPublic !== undefined) changes.is_public = body.isPublic;
    if (body.defaultLayers !== undefined) changes.default_layers = sql.json(body.defaultLayers as never);
    if (Object.keys(changes).length) await sql`update templates set ${sql(changes)} where id = ${id}`;
    return c.json(await loadTemplate(id, user));
  });

  app.delete("/api/templates/:id", async (c) => {
    const { id } = await ownTemplate(c);
    // Memes keep their template (`on delete restrict`); deleting a parent would also take its variations.
    const [used] = await sql`select 1 from memes m join templates t on t.id = m.template_id
      where t.id = ${id} or t.parent_id = ${id} limit 1`;
    if (used) throw new HttpError(409, "template is used by memes and can't be deleted");
    await sql`delete from templates where id = ${id}`;
    return c.body(null, 204);
  });

  /** Any signed-in user who can see the template adds (non-base) tags; nobody removes base tags. */
  app.post("/api/templates/:id/tags", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { tags } = await parseJson(c, setTagsSchema);
    const [row] = await sql`select 1 from templates where id = ${id} and (is_public or owner_id = ${user.id})`;
    if (!row) throw new HttpError(404, "template not found");
    await addTemplateTags(sql, id, tags, user.id, false);
    return c.json(await loadTemplate(id, user));
  });

  // ---- tags ------------------------------------------------------------------

  app.get("/api/tags", async (c) => {
    const { q, kind, limit } = parse(tagsQuerySchema, c.req.query());
    const viewerId = c.get("user")?.id ?? null;
    const rows = await sql<TagRow[]>`
      select * from (${tagSelect(sql, viewerId)}) s
      where true
      ${q ? sql`and (s.slug like ${"%" + tagSlug(q) + "%"} or s.name ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"})` : sql``}
      ${kind ? sql`and s.kind = ${kind}` : sql``}
      order by s.template_count + s.meme_count desc, s.slug
      limit ${limit}`;
    return c.json(rows.map(toTag));
  });

  app.get("/api/tags/:slug", async (c) => {
    const slug = parse(tagSlugSchema, c.req.param("slug"));
    const [row] = await sql<TagRow[]>`${tagSelect(sql, c.get("user")?.id ?? null)} where g.slug = ${slug}`;
    if (!row) throw new HttpError(404, "tag not found");
    return c.json(toTag(row));
  });

  /** Explicit creation, e.g. a `team` tag with a description. Tagging also creates topic tags implicitly. */
  app.post("/api/tags", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createTagSchema);
    const slug = tagSlug(body.name);
    if (!slug) throw new HttpError(400, "tag name needs at least one letter or digit");
    const [row] = await sql<{ slug: string }[]>`
      insert into tags ${sql({ slug, name: body.name, kind: body.kind, description: body.description, created_by: user.id })}
      on conflict (slug) do nothing returning slug`;
    if (!row) throw new HttpError(409, `tag "${slug}" already exists`);
    const [tag] = await sql<TagRow[]>`${tagSelect(sql, user.id)} where g.slug = ${slug}`;
    return c.json(toTag(tag!), 201);
  });

  // ---- memes -----------------------------------------------------------------

  app.post("/api/memes", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createMemeSchema);
    const template = await loadTemplate(body.templateId, user);
    const output = await requireMediaAsset(body.outputAssetId, "outputAssetId");
    if (output.owner_id !== user.id) throw new HttpError(403, "outputAssetId must be uploaded by you");
    const [row] = await sql<{ id: string }[]>`
      insert into memes ${sql({
        owner_id: user.id,
        template_id: template.id,
        source_asset_id: template.asset.id,
        output_asset_id: output.id,
        title: body.title,
        layers: sql.json(body.layers as never),
        visibility: body.visibility,
        posted_at: body.post ? new Date() : null,
      })} returning id`;
    if (body.tags.length) await replaceMemeTags(sql, row!.id, body.tags, user.id);
    return c.json(toMeme(await loadMeme(row!.id, user)), 201);
  });

  app.get("/api/memes/:id", async (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(toMeme(await loadMeme(id, c.get("user"))));
  });

  const ownMeme = async (c: Context<Env>) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const meme = await loadMeme(id, user);
    if (meme.owner_id !== user.id) throw new HttpError(403, "only the owner can change this meme");
    return { user, id };
  };

  app.patch("/api/memes/:id", async (c) => {
    const { user, id } = await ownMeme(c);
    const body = await parseJson(c, updateMemeSchema);
    const changes: Record<string, unknown> = {};
    if (body.title !== undefined) changes.title = body.title;
    if (body.visibility !== undefined) changes.visibility = body.visibility;
    if (body.layers && body.outputAssetId) {
      const output = await requireMediaAsset(body.outputAssetId, "outputAssetId");
      if (output.owner_id !== user.id) throw new HttpError(403, "outputAssetId must be uploaded by you");
      changes.layers = sql.json(body.layers as never);
      changes.output_asset_id = output.id;
    }
    if (Object.keys(changes).length) {
      await sql`update memes set ${sql(changes)}, updated_at = now() where id = ${id}`;
    }
    if (body.tags) await replaceMemeTags(sql, id, body.tags, user.id);
    return c.json(toMeme(await loadMeme(id, user)));
  });

  app.post("/api/memes/:id/post", async (c) => {
    const { user, id } = await ownMeme(c);
    await sql`update memes set posted_at = coalesce(posted_at, now()), updated_at = now() where id = ${id}`;
    return c.json(toMeme(await loadMeme(id, user)));
  });

  app.delete("/api/memes/:id", async (c) => {
    const { id } = await ownMeme(c);
    await sql`delete from memes where id = ${id}`;
    return c.body(null, 204);
  });

  app.put("/api/memes/:id/vote", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { value } = await parseJson(c, voteSchema);
    const meme = await loadMeme(id, user);
    if (meme.visibility !== "public" || !meme.posted_at) {
      throw new HttpError(400, "only posted public memes can be voted on");
    }
    if (value === 0) {
      await sql`delete from votes where user_id = ${user.id} and meme_id = ${id}`;
    } else {
      await sql`
        insert into votes (user_id, meme_id, value) values (${user.id}, ${id}, ${value})
        on conflict (user_id, meme_id) do update set value = excluded.value, created_at = now()
        where votes.value <> excluded.value`;
    }
    return c.json(toMeme(await loadMeme(id, user)));
  });

  /** Star (save to Favorites) or unstar; like votes, only posted public memes. Idempotent. */
  app.put("/api/memes/:id/favorite", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { favorite } = await parseJson(c, favoriteSchema);
    const meme = await loadMeme(id, user);
    if (meme.visibility !== "public" || !meme.posted_at) {
      throw new HttpError(400, "only posted public memes can be favorited");
    }
    if (favorite) {
      await sql`insert into favorites (user_id, meme_id) values (${user.id}, ${id}) on conflict do nothing`;
    } else {
      await sql`delete from favorites where user_id = ${user.id} and meme_id = ${id}`;
    }
    return c.json(toMeme(await loadMeme(id, user)));
  });

  // ---- comments --------------------------------------------------------------

  app.get("/api/memes/:id/comments", async (c) => {
    const { id } = parse(idParam, c.req.param());
    const { offset, limit } = parse(commentsQuery, c.req.query());
    await loadMeme(id, c.get("user"));
    const top = await sql<CommentRow[]>`${commentSelect(sql)}
      where c.meme_id = ${id} and c.parent_id is null
      order by c.created_at, c.id
      offset ${offset} limit ${limit + 1}`;
    const { items: shown, nextOffset } = page(top, offset, limit);
    const replies = shown.length
      ? await sql<CommentRow[]>`${commentSelect(sql)}
          where c.parent_id in ${sql(shown.map((r) => r.id))}
          order by c.created_at, c.id`
      : [];
    const byParent = Map.groupBy(replies, (r) => r.parent_id!);
    const items = shown.map((r) => toComment(r, (byParent.get(r.id) ?? []).map((reply) => toComment(reply))));
    return c.json({ items, nextOffset });
  });

  app.post("/api/memes/:id/comments", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    const { body, parentId } = await parseJson(c, createCommentSchema);
    const meme = await loadMeme(id, user);
    if (meme.visibility !== "public" || !meme.posted_at) {
      throw new HttpError(400, "only posted public memes can be commented on");
    }
    if (parentId) {
      const [parent] = await sql`
        select 1 from comments where id = ${parentId} and meme_id = ${id} and parent_id is null`;
      if (!parent) throw new HttpError(400, "replies must answer a top-level comment on this meme");
    }
    const [row] = await sql<{ id: string }[]>`
      insert into comments ${sql({ meme_id: id, parent_id: parentId ?? null, author_id: user.id, body })}
      returning id`;
    const [comment] = await sql<CommentRow[]>`${commentSelect(sql)} where c.id = ${row!.id}`;
    return c.json(toComment(comment!), 201);
  });

  /**
   * Author only. A comment with replies becomes a placeholder (soft delete); otherwise it is removed,
   * along with its soft-deleted parent once that has no replies left.
   */
  app.delete("/api/comments/:id", async (c) => {
    const user = requireUser(c);
    const { id } = parse(idParam, c.req.param());
    await sql.begin(async (tx) => {
      const [row] = await tx<{ author_id: string; parent_id: string | null }[]>`
        select author_id, parent_id from comments where id = ${id} for update`;
      if (!row) throw new HttpError(404, "comment not found");
      if (row.author_id !== user.id) throw new HttpError(403, "only the author can delete this comment");
      // Lock the parent so concurrent reply deletions agree on whether it still has replies.
      if (row.parent_id) await tx`select 1 from comments where id = ${row.parent_id} for update`;
      const [hasReplies] = await tx`select 1 from comments where parent_id = ${id} limit 1`;
      if (hasReplies) {
        await tx`update comments set deleted_at = coalesce(deleted_at, now()) where id = ${id}`;
        return;
      }
      await tx`delete from comments where id = ${id}`;
      if (row.parent_id) {
        await tx`
          delete from comments p where p.id = ${row.parent_id} and p.deleted_at is not null
            and not exists (select 1 from comments r where r.parent_id = p.id)`;
      }
    });
    return c.body(null, 204);
  });

  // ---- gallery ---------------------------------------------------------------

  app.get("/api/gallery", async (c) => {
    const { period, sort, offset, limit, tag } = parse(galleryQuerySchema, c.req.query());
    const viewerId = c.get("user")?.id ?? null;
    const since =
      period === "all" ? sql`` : sql`and m.posted_at >= now() - ${PERIOD_INTERVAL[period]}::interval`;
    const order = sort === "best" ? sql`m.score desc, m.posted_at desc` : sql`m.posted_at desc`;
    const rows = await sql<MemeRow[]>`${memeSelect(sql, viewerId)}
      where m.visibility = 'public' and m.posted_at is not null ${since}
      ${tag ? sql`and exists (select 1 from meme_tag_matches x join tags g on g.id = x.tag_id
        where x.meme_id = m.id and g.slug = ${tag})` : sql``}
      order by ${order}, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });

  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
