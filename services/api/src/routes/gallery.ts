import { galleryQuerySchema } from "@memegen/shared";
import { page, parse, type Sql } from "@memegen/server-kit";
import type { ApiApp } from "../access.ts";
import { memeListed, memeSelect, periodStart, toMeme, type MemeRow } from "../rows.ts";

/** Listed memes by period and sort, optionally narrowed to a tag. */
export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/gallery", async (c) => {
    const { period, sort, offset, limit, tag } = parse(galleryQuerySchema, c.req.query());
    const since = period === "all" ? sql`` : sql`and m.posted_at >= ${periodStart(sql, period)}`;
    const order = sort === "best" ? sql`m.score desc, m.posted_at desc` : sql`m.posted_at desc`;
    const rows = await sql<MemeRow[]>`${memeSelect(sql, c.get("user")?.id ?? null)}
      where ${memeListed(sql)} ${since}
      ${tag ? sql`and exists (select 1 from meme_tag_matches x join tags g on g.id = x.tag_id
        where x.meme_id = m.id and g.slug = ${tag})` : sql``}
      order by ${order}, m.id
      offset ${offset} limit ${limit + 1}`;
    return c.json(page(rows.map(toMeme), offset, limit));
  });
}
