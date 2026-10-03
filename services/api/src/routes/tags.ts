import { createTagSchema, tagSlug, tagSlugSchema, tagsQuerySchema } from "@memegen/shared";
import { HttpError, parse, parseJson, type Sql } from "@memegen/server-kit";
import { requireUser, type ApiApp } from "../access.ts";
import { containsPattern, tagSelect, toTag, type TagRow } from "../rows.ts";

/** Tag search, lookup, and explicit creation. */
export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/tags", async (c) => {
    const { q, kind, limit } = parse(tagsQuerySchema, c.req.query());
    const viewerId = c.get("user")?.id ?? null;
    const rows = await sql<TagRow[]>`
      select * from (${tagSelect(sql, viewerId)}) s
      where true
      ${q ? sql`and (s.slug like ${"%" + tagSlug(q) + "%"} or s.name ilike ${containsPattern(q)})` : sql``}
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
}
