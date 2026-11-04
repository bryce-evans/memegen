import type { HotTemplate, Period, Template, TemplateUsage } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";
import { periodStart, templateSelect, templateVisibleTo, withVariations, type TemplateRow } from "./rows.ts";

const PERIOD_BUCKET: Record<Period, TemplateUsage["bucket"]> = {
  day: "hour", week: "day", month: "day", year: "month", all: "month",
};

/** Variation usage rolls up into its top-level template. */
export async function hotTemplates(sql: Sql, viewerId: string | null, period: Period, limit: number): Promise<HotTemplate[]> {
  const since = period === "all" ? sql`` : sql`and u.created_at >= ${periodStart(sql, period)}`;
  const ranked = await sql<{ id: string; uses: number; posts: number }[]>`
    select u.root_template_id as id,
      count(*) filter (where u.kind = 'created')::int as uses,
      count(*) filter (where u.kind = 'posted')::int as posts
    from template_uses u join templates t on t.id = u.root_template_id
    where ${templateVisibleTo(sql, viewerId)} ${since}
    group by u.root_template_id order by uses desc, posts desc, u.root_template_id limit ${limit}`;
  if (!ranked.length) return [];
  const rows = await sql<TemplateRow[]>`${templateSelect(sql)} where t.id in ${sql(ranked.map((r) => r.id))}`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const templates = await withVariations(sql, ranked.map((r) => byId.get(r.id)!), viewerId);
  return ranked.map((r, i) => ({ template: templates[i]!, uses: r.uses, posts: r.posts }));
}

/** Zero-filled time series; the caller authorizes opening the template. */
export async function templateUsage(sql: Sql, template: Template, period: Period): Promise<TemplateUsage> {
  const id = template.id;
  const bucket = PERIOD_BUCKET[period];
  const match = template.parentId ? sql`u.template_id = ${id}` : sql`u.root_template_id = ${id}`;
  const start = period === "all"
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
  return { templateId: id, period, bucket, points: points.map((p) => ({ at: p.at.toISOString(), uses: p.uses, posts: p.posts })) };
}
