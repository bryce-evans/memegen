import {
  createTemplateSchema,
  hotTemplatesQuerySchema,
  setTagsSchema,
  templatesQuerySchema,
  templateUsageQuerySchema,
  updateTemplateSchema,
  type HotTemplate,
  type Period,
  type TemplateUsage,
} from "@memegen/shared";
import { HttpError, idParam, page, parse, parseJson, type Sql } from "@memegen/server-kit";
import { loadTemplate, ownTemplate, requireMediaAsset, requireUser, type ApiApp } from "../access.ts";
import {
  addTemplateTags,
  containsPattern,
  periodStart,
  templateSelect,
  templateVisibleTo,
  withVariations,
  type TemplateRow,
} from "../rows.ts";

/** Time-series granularity for each period. */
const PERIOD_BUCKET: Record<Period, TemplateUsage["bucket"]> = {
  day: "hour",
  week: "day",
  month: "day",
  year: "month",
  all: "month",
};

/** Template browsing, usage stats, authoring, and community tags. */
export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/templates", async (c) => {
    const { q, tag, offset, limit } = parse(templatesQuerySchema, c.req.query());
    const viewerId = c.get("user")?.id ?? null;
    const rows = await sql<TemplateRow[]>`${templateSelect(sql)}
      where t.parent_id is null and ${templateVisibleTo(sql, viewerId)}
      ${q ? sql`and t.name ilike ${containsPattern(q)}` : sql``}
      ${tag ? sql`and exists (select 1 from template_tag_matches x join tags g on g.id = x.tag_id
        where x.template_id = t.id and g.slug = ${tag})` : sql``}
      order by lower(t.name), t.id
      offset ${offset} limit ${limit + 1}`;
    const { items, nextOffset } = page(rows, offset, limit);
    return c.json({ items: await withVariations(sql, items, viewerId), nextOffset });
  });

  /** Most-used top-level templates in the period; variation uses roll up into their parent. */
  app.get("/api/templates/hot", async (c) => {
    const { period, limit } = parse(hotTemplatesQuerySchema, c.req.query());
    const viewerId = c.get("user")?.id ?? null;
    const since = period === "all" ? sql`` : sql`and u.created_at >= ${periodStart(sql, period)}`;
    const ranked = await sql<{ id: string; uses: number; posts: number }[]>`
      select u.root_template_id as id,
        count(*) filter (where u.kind = 'created')::int as uses,
        count(*) filter (where u.kind = 'posted')::int as posts
      from template_uses u
      join templates t on t.id = u.root_template_id
      where ${templateVisibleTo(sql, viewerId)} ${since}
      group by u.root_template_id
      order by uses desc, posts desc, u.root_template_id
      limit ${limit}`;
    if (!ranked.length) return c.json([]);
    const rows = await sql<TemplateRow[]>`${templateSelect(sql)} where t.id in ${sql(ranked.map((r) => r.id))}`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const templates = await withVariations(sql, ranked.map((r) => byId.get(r.id)!), viewerId);
    const items: HotTemplate[] = ranked.map((r, i) => ({ template: templates[i]!, uses: r.uses, posts: r.posts }));
    return c.json(items);
  });

  /** Zero-filled usage time series for one template (top-level includes its variations). */
  app.get("/api/templates/:id/usage", async (c) => {
    const { id } = parse(idParam, c.req.param());
    const { period } = parse(templateUsageQuerySchema, c.req.query());
    const template = await loadTemplate(sql, id, c.get("user"));
    const bucket = PERIOD_BUCKET[period];
    const match = template.parentId ? sql`u.template_id = ${id}` : sql`u.root_template_id = ${id}`;
    const start =
      period === "all"
        ? sql`coalesce((select min(u.created_at) from template_uses u where ${match}), now())`
        : periodStart(sql, period);
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
    return c.json(await loadTemplate(sql, id, c.get("user")));
  });

  app.post("/api/templates", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createTemplateSchema);
    await requireMediaAsset(sql, body.assetId, "assetId");
    if (body.parentId) {
      const [parent] = await sql<{ parent_id: string | null }[]>`
        select t.parent_id from templates t where t.id = ${body.parentId} and ${templateVisibleTo(sql, user.id)}`;
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
    return c.json(await loadTemplate(sql, row!.id, user), 201);
  });

  app.patch("/api/templates/:id", async (c) => {
    const { user, id } = await ownTemplate(sql, c);
    const body = await parseJson(c, updateTemplateSchema);
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.isPublic !== undefined) changes.is_public = body.isPublic;
    if (body.defaultLayers !== undefined) changes.default_layers = sql.json(body.defaultLayers as never);
    if (Object.keys(changes).length) await sql`update templates set ${sql(changes)} where id = ${id}`;
    return c.json(await loadTemplate(sql, id, user));
  });

  app.delete("/api/templates/:id", async (c) => {
    const { id } = await ownTemplate(sql, c);
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
    const [row] = await sql`select 1 from templates t where t.id = ${id} and ${templateVisibleTo(sql, user.id)}`;
    if (!row) throw new HttpError(404, "template not found");
    await addTemplateTags(sql, id, tags, user.id, false);
    return c.json(await loadTemplate(sql, id, user));
  });
}
