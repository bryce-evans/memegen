import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSql, searchConfig } from "@memegen/server-kit";
import type { SearchHit } from "@memegen/shared";
import { TemplateCatalog } from "../services/search/src/catalog.ts";
import { Clip } from "../services/search/src/clip.ts";
import { fetchFromStorage } from "../services/search/src/storage.ts";

// Read-only review: never merge templates or alter registry policy based on CLIP alone.
const threshold = 0.97;
const sql = createSql();
try {
  const rows = await sql<{
    id: string; name: string; slug: string | null; asset_id: string; sha256: string;
    parent_id: string | null; is_public: boolean; kind: string;
  }[]>`
    select t.id, t.name, t.slug, t.asset_id, t.parent_id, t.is_public, a.sha256, a.kind
    from templates t join assets a on a.id = t.asset_id
    where t.owner_id = memegen_user_id() order by t.id`;
  const eligible = rows.filter((row) => row.kind === "image" || row.kind === "gif");
  const skipped = rows.filter((row) => row.kind !== "image" && row.kind !== "gif");
  const catalog = new TemplateCatalog(sql, Clip.load(searchConfig.model, searchConfig.dataDir),
    fetchFromStorage(searchConfig.storageUrl), searchConfig.dataDir, searchConfig.model);
  await catalog.sync();
  const candidates = eligible.map((row) => ({ templateId: row.id, groupId: row.id }));
  const byId = new Map(eligible.map((row) => [row.id, row]));
  const pairs = [];
  const missing: string[] = [];
  // One query per asset; retain separate identities and flag variants rather than hiding them.
  const hitsByAsset = new Map<string, SearchHit[]>();
  for (const [i, row] of eligible.entries()) {
    let hits = hitsByAsset.get(row.asset_id);
    if (!hits) {
      hits = await catalog.similar(row.asset_id, candidates.length, candidates);
      hitsByAsset.set(row.asset_id, hits);
    }
    if (!hits.some((hit) => hit.templateId === row.id)) missing.push(row.id);
    for (const hit of hits) {
      if (hit.templateId <= row.id || hit.score < threshold) continue;
      const other = byId.get(hit.templateId)!;
      pairs.push({ similarity: hit.score, identicalBytes: row.sha256 === other.sha256,
        sameFamily: (row.parent_id ?? row.id) === (other.parent_id ?? other.id),
        left: row, right: other });
    }
    if ((i + 1) % 100 === 0) console.log(`checked ${i + 1}/${eligible.length} seeded templates`);
  }
  pairs.sort((a, b) => b.similarity - a.similarity || a.left.id.localeCompare(b.left.id) || a.right.id.localeCompare(b.right.id));
  const publicPairs = pairs.filter((pair) => pair.left.is_public && pair.right.is_public && !pair.sameFamily);
  const report = { model: searchConfig.model, threshold, seededTemplates: rows.length,
    indexedSeededTemplates: eligible.length - missing.length, skipped, missing, publicPairs: publicPairs.length, pairs };
  await mkdir(searchConfig.dataDir, { recursive: true });
  const path = join(searchConfig.dataDir, "seed-duplicates.json");
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, pairs: pairs.length, report: path }));
  console.log("Public cross-family candidates (including intentional format differences):");
  for (const pair of publicPairs) {
    console.log(`${pair.similarity.toFixed(3)}${pair.identicalBytes ? " identical bytes" : ""}\t${pair.left.name} [${pair.left.slug}]\t${pair.right.name} [${pair.right.slug}]`);
  }
  if (missing.length) throw new Error(`${missing.length} seeded templates were not indexed; see ${path}`);
} finally {
  await sql.end();
}
