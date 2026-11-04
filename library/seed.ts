import { parseArgs } from "node:util";
import { tagSlug } from "@memegen/shared";
import { createSql, migrate } from "@memegen/server-kit";
import { assetStoreFromEnv } from "@memegen/storage";
import { insertTemplate } from "../scripts/lib.ts";
import { manifestLayers, type ManifestFonts } from "./manifest.ts";
import { addRegistryAliases, duplicateCanonical, loadRegistry, reconcileRegistry, registryRisk, rootVisibility } from "./registry.ts";

const { values } = parseArgs({
  options: { manifest: { type: "string" }, limit: { type: "string" } },
});
const limit = values.limit === undefined ? Infinity : Number(values.limit);
if (values.limit !== undefined && (!/^\d+$/.test(values.limit) || !Number.isSafeInteger(limit))) {
  throw new Error("--limit must be a non-negative safe integer");
}
const registry = await loadRegistry({ manifest: values.manifest });

async function main() {
  const sql = createSql();
  try {
    await migrate(sql);
    await reconcileRegistry(sql, registry);
    const store = assetStoreFromEnv(sql);
    let fonts: ManifestFonts | undefined;
    let created = 0;
    let present = 0;
    let aliases = 0;
    const failures: string[] = [];
    const entries = registry.selected.filter((entry) => !duplicateCanonical(registry, entry.slug)
      && rootVisibility(registry, { id: "", slug: entry.slug, name: entry.title, identities: [] }) !== false);
    for (const entry of entries.slice(0, limit)) {
      try {
        const identity = tagSlug(entry.slug);
        const [existing] = await sql<{ id: string; slug: string | null }[]>`
          select t.id, t.slug from templates t
          where t.owner_id = memegen_user_id() and (t.slug = ${entry.slug}
             or (t.parent_id is null and t.is_public
               and exists (select 1 from template_tags tt join tags g on g.id = tt.tag_id
                 where tt.template_id = t.id and tt.base and g.slug = ${identity})))
          order by (t.slug = ${entry.slug}) desc limit 1`;
        const existingRisk = existing?.slug ? registryRisk(registry, existing.slug) : undefined;
        if (existing && existingRisk !== undefined && entry.risk <= existingRisk) {
          await addRegistryAliases(sql, existing.id, entry);
          present++;
          continue;
        }
        if (!fonts) {
          const rows = await sql<{ id: string; name: string }[]>`
            select id, name from assets where kind = 'font' and name in ('Impact', 'Noto Sans Bold', 'Titillium Web SemiBold', 'Kalam')
            order by created_at, id`;
          const impact = rows.find((row) => row.name === "Impact")?.id;
          const sans = rows.find((row) => row.name === "Noto Sans Bold")?.id;
          if (!impact || !sans) throw new Error("Import local fonts first: Impact and Noto Sans Bold assets are required");
          fonts = {
            impact, sans,
            thin: rows.find((row) => row.name === "Titillium Web SemiBold")?.id,
            comic: rows.find((row) => row.name === "Kalam")?.id,
          };
        }
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error(`download returned HTTP ${response.status} (${entry.url})`);
        const data = new Uint8Array(await response.arrayBuffer());
        const asset = await store.uploadOnce({
          data, filename: new URL(entry.url).pathname.split("/").pop()!, name: entry.title, ownerId: null,
        });
        if (asset.kind !== "image" && asset.kind !== "gif") throw new Error(`expected image or GIF, received ${asset.kind}`);
        const layers = manifestLayers(entry, fonts, asset.kind === "image" ? null : (asset.durationMs ?? 0) / 1000);
        const [duplicate] = await sql<{ id: string; slug: string | null }[]>`
          select t.id, t.slug from templates t join assets a on a.id = t.asset_id
          where a.sha256 = (select sha256 from assets where id = ${asset.id})
            and t.parent_id is null and t.is_public and t.owner_id = memegen_user_id()
          order by t.created_at, t.id limit 1`;
        // Higher-risk entries never annotate a lower-risk canonical merely because their bytes are identical.
        const duplicateRisk = duplicate?.slug ? registryRisk(registry, duplicate.slug) : undefined;
        if (duplicate && (duplicateRisk === undefined || entry.risk > duplicateRisk)) {
          aliases++;
          continue;
        }
        const id = duplicate?.id ?? await insertTemplate(sql, {
          slug: entry.slug, name: entry.title, assetId: asset.id, layers,
        });
        await addRegistryAliases(sql, id, entry);
        if (duplicate) {
          aliases++;
          console.log(`alias ${entry.slug} — ${entry.title}`);
        } else {
          created++;
          console.log(`online ${entry.slug} — ${entry.title}`);
        }
      } catch (error) {
        const message = `${entry.slug}: ${error instanceof Error ? error.message : String(error)}`;
        failures.push(message);
        console.error(`failed ${message}`);
      }
    }
    console.log(`online templates: ${created} created, ${aliases} aliases, ${present} present, ${failures.length} failed`);
    if (failures.length) throw new AggregateError(failures.map((message) => new Error(message)), "Online template import failed; rerun to resume");
  } finally {
    try {
      await reconcileRegistry(sql, registry);
    } finally {
      await sql.end();
    }
  }
}

await main();
