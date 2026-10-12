import { galleryQuerySchema } from "@memegen/shared";
import { page, pageSql, parse, type Sql } from "@memegen/server-kit";
import type { ApiApp } from "../access.ts";
import { containsPattern, memeListed, memeSelect, periodStart, tagMatches, toMeme, type MemeRow } from "../rows.ts";

/**
 * `q` matches the meme's title, its template's or parent template's name, any tag that matches it (own or the
 * template's), or its author's username.
 */
function searchFilter(sql: Sql, q: string) {
  const text = containsPattern(q);
  return sql`and (
    m.title ilike ${text}
    or u.username ilike ${text}
    or exists (select 1 from templates t left join templates p on p.id = t.parent_id
      where t.id = m.template_id and (t.name ilike ${text} or p.name ilike ${text}))
    or exists (select 1 from meme_tag_matches x join tags g on g.id = x.tag_id
      where x.meme_id = m.id and ${tagMatches(sql, q, "g")}))`;
}

/** Listed memes by period and sort, optionally narrowed to a tag and/or a search. */
export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/gallery", async (c) => {
    const { period, sort, offset, limit, tag, q } = parse(galleryQuerySchema, c.req.query());
    const since = period === "all" ? sql`` : sql`and m.posted_at >= ${periodStart(sql, period)}`;
    const order = sort === "best" ? sql`m.score desc, m.posted_at desc` : sql`m.posted_at desc`;
    const rows = await sql<MemeRow[]>`${memeSelect(sql, c.get("user")?.id ?? null)}
      where ${memeListed(sql)} ${since}
      ${tag ? sql`and exists (select 1 from meme_tag_matches x join tags g on g.id = x.tag_id
        where x.meme_id = m.id and g.slug = ${tag})` : sql``}
      ${q ? searchFilter(sql, q) : sql``}
      order by ${order}, m.id
      ${pageSql(sql, offset, limit)}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });
}
