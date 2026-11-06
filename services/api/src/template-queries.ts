import type { Page, SearchCandidate, Template, TemplateDuplicate, TemplateKind } from "@memegen/shared";
import { HttpError, page, pageSql, type Sql, type SqlFragment } from "@memegen/server-kit";
import { containsPattern, tagMatches, templateSelect, templateVisibleTo, withVariations, type TemplateRow } from "./rows.ts";
import type { TemplateSearch } from "./search.ts";

const VISUAL_SEARCH_LIMIT = 48;
const DUPLICATE_LIMIT = 12;

/** Preserve requested ranking, rechecking visibility after optional search completes. */
async function templateRows(sql: Sql, ids: string[], viewerId: string | null): Promise<TemplateRow[]> {
  if (!ids.length) return [];
  const rows = await sql<TemplateRow[]>`${templateSelect(sql)} where t.id in ${sql(ids)} and ${templateVisibleTo(sql, viewerId)}`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** API owns eligibility and root grouping; the sidecar only ranks the supplied candidates. */
async function searchTemplateIds(sql: Sql, search: TemplateSearch | null, q: string, listed: SqlFragment, viewerId: string | null) {
  const query = q.trim();
  const terms = [...new Set(query.split(/\s+/).filter(Boolean))];
  const matches = terms.map((term) => sql`(t.name ilike ${containsPattern(term)} or exists (
    select 1 from template_tag_matches x join tags g on g.id = x.tag_id
    where x.template_id = t.id and ${tagMatches(sql, term, "g")}))`);
  const allTerms = matches.reduce((combined, match) => sql`${combined} and ${match}`, sql`true`);
  const text = await sql<{ id: string }[]>`select t.id from templates t
    where ${listed} and ${allTerms}
    order by (lower(t.name) = lower(${query})) desc,
      (t.name ilike ${containsPattern(query)}) desc, t.created_at desc, t.id`;
  const ids = new Set(text.map((r) => r.id));
  // Semantic suggestions are a fallback, not an OR that broadens a precise text query.
  if (ids.size || !search || !terms.length) return [...ids];
  const candidates = await sql<SearchCandidate[]>`
    select h.id as "templateId", t.id as "groupId"
    from templates h join templates t on t.id = coalesce(h.parent_id, h.id)
    where ${templateVisibleTo(sql, viewerId, "h")} and ${listed}`;
  const hits = candidates.length ? await search.text(q, VISUAL_SEARCH_LIMIT, candidates) : [];
  if (hits.length) {
    // A visibility/filter change during the request must not turn a candidate into an authorization grant.
    const roots = await sql<{ hit: string; id: string }[]>`
      select h.id as hit, t.id from templates h join templates t on t.id = coalesce(h.parent_id, h.id)
      where h.id in ${sql(hits.map((h) => h.templateId))} and ${templateVisibleTo(sql, viewerId, "h")} and ${listed}`;
    const rootOf = new Map(roots.map((r) => [r.hit, r.id]));
    for (const hit of hits) {
      const id = rootOf.get(hit.templateId);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export async function browseTemplates(
  sql: Sql,
  search: TemplateSearch | null,
  viewerId: string | null,
  { q, tag, kind, offset, limit }: { q?: string; tag?: string; kind?: TemplateKind; offset: number; limit: number },
): Promise<Page<Template>> {
  const listed = sql`t.parent_id is null and ${templateVisibleTo(sql, viewerId)}
    ${kind ? sql`and t.kind = ${kind}` : sql``}
    ${tag ? sql`and exists (select 1 from template_tag_matches x join tags g on g.id = x.tag_id
      where x.template_id = t.id and g.slug = ${tag})` : sql``}`;
  if (q) {
    const ids = await searchTemplateIds(sql, search, q, listed, viewerId);
    const rows = await templateRows(sql, ids.slice(offset, offset + limit), viewerId);
    return { items: await withVariations(sql, rows, viewerId), nextOffset: ids.length > offset + limit ? offset + limit : null };
  }
  const rows = await sql<TemplateRow[]>`${templateSelect(sql)} where ${listed}
    order by t.created_at desc, t.id ${pageSql(sql, offset, limit)}`;
  const { items, nextOffset } = page(rows, offset, limit);
  return { items: await withVariations(sql, items, viewerId), nextOffset };
}

export async function templateCount(sql: Sql, viewerId: string | null): Promise<{ count: number }> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from templates t where t.parent_id is null and ${templateVisibleTo(sql, viewerId)}`;
  return row!;
}

export async function templateDuplicates(sql: Sql, search: TemplateSearch | null, assetId: string, viewerId: string): Promise<TemplateDuplicate[]> {
  const [asset] = await sql<{ sha256: string }[]>`select sha256 from assets where id = ${assetId}`;
  if (!asset) throw new HttpError(404, "asset not found");
  const exact = await sql<{ id: string }[]>`select t.id from templates t join assets a on a.id = t.asset_id
    where a.sha256 = ${asset.sha256} and ${templateVisibleTo(sql, viewerId)} order by t.created_at, t.id`;
  const candidates = search ? await sql<SearchCandidate[]>`select t.id as "templateId", t.id as "groupId"
    from templates t where ${templateVisibleTo(sql, viewerId)}` : [];
  const hits = search && candidates.length ? await search.similar(assetId, DUPLICATE_LIMIT, candidates) : [];
  const exactIds = new Set(exact.map((r) => r.id));
  const similarity = new Map(hits.map((h) => [h.templateId, h.score]));
  const ids = [...new Set([...exactIds, ...hits.map((h) => h.templateId)])];
  const templates = await withVariations(sql, await templateRows(sql, ids, viewerId), viewerId);
  return templates.map((template) => ({ template, exact: exactIds.has(template.id), similarity: similarity.get(template.id) ?? null }));
}
