import { tagSlug } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";
import { assetStoreFromEnv, type AssetStore } from "@memegen/storage";
import { insertTemplate } from "../scripts/lib.ts";
import { manifestLayers, type ManifestFonts } from "./manifest.ts";
import { addRegistryAliases, duplicateCanonical, registryRisk, rootVisibility, type Registry } from "./registry.ts";
import { LIBRARY_FONTS } from "./fonts.ts";
import { importPanelTemplate, PanelRecipeRenderer } from "./import-panels.ts";

export async function importManifest(sql: Sql, registry: Registry, limit: number, store: AssetStore = assetStoreFromEnv(sql)): Promise<void> {
    let fonts: ManifestFonts | undefined;
    let created = 0;
    let present = 0;
    let aliases = 0;
    const failures: string[] = [];
    const entries = registry.selected.filter((entry) => !duplicateCanonical(registry, entry.slug)
      && rootVisibility(registry, { id: "", slug: entry.slug, name: entry.title, identities: [] }) !== false);
    const renderer = new PanelRecipeRenderer();
    try {
    for (const entry of entries.slice(0, limit)) {
      try {
        const identity = tagSlug(entry.slug);
        const [existing] = await sql<{ id: string; slug: string | null; is_panel: boolean }[]>`
          select t.id, t.slug, t.panels is not null as is_panel from templates t
          where t.owner_id = memegen_user_id() and (t.slug = ${entry.slug}
             or (${entry.layout !== "panels"} and t.panels is null and t.parent_id is null and t.is_public
               and exists (select 1 from template_tags tt join tags g on g.id = tt.tag_id
                 where tt.template_id = t.id and tt.base and g.slug = ${identity})))
          order by (t.slug = ${entry.slug}) desc limit 1`;
        if (existing && existing.is_panel !== (entry.layout === "panels")) {
          throw new Error("existing template has a different layout kind; use a distinct recipe slug");
        }
        const existingRisk = existing?.slug ? registryRisk(registry, existing.slug) : undefined;
        if (existing && (entry.layout === "panels" || existingRisk !== undefined && entry.risk <= existingRisk)) {
          if (existing.slug !== entry.slug) await addRegistryAliases(sql, existing.id, entry);
          if (entry.layout === "panels") await importPanelTemplate(sql, store, renderer, entry);
          present++;
          continue;
        }
        if (entry.layout === "panels") {
          await importPanelTemplate(sql, store, renderer, entry);
          created++;
          console.log(`panels ${entry.slug} — ${entry.title}`);
          continue;
        }
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error(`download returned HTTP ${response.status} (${entry.url})`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (!fonts) {
          const names = LIBRARY_FONTS.filter((font) => font.role).map((font) => font.name);
          const rows = await sql<{ id: string; name: string }[]>`
            select id, name from assets where kind = 'font' and name in ${sql(names)}
            order by created_at, id`;
          const ids: Partial<ManifestFonts> = {};
          for (const font of LIBRARY_FONTS) {
            if (font.role) ids[font.role] = rows.find((row) => row.name === font.name)?.id;
          }
          if (!ids.impact || !ids.sans) throw new Error("Import local fonts first: Impact and Noto Sans Bold assets are required");
          fonts = { ...ids, impact: ids.impact, sans: ids.sans };
        }
        const asset = await store.uploadOnce({
          data, filename: new URL(entry.url).pathname.split("/").pop()!, name: entry.title, ownerId: null,
        });
        if (asset.kind !== "image" && asset.kind !== "gif") throw new Error(`expected image or GIF, received ${asset.kind}`);
        const layers = manifestLayers(entry, fonts, asset.kind === "image" ? null : (asset.durationMs ?? 0) / 1000);
        const [duplicate] = await sql<{ id: string; slug: string | null }[]>`
          select t.id, t.slug from templates t join assets a on a.id = t.asset_id
          where a.sha256 = (select sha256 from assets where id = ${asset.id})
            and t.panels is null and t.parent_id is null and t.is_public and t.owner_id = memegen_user_id()
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
        if (duplicate) {
          await addRegistryAliases(sql, id, entry);
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
    } finally {
      await renderer.close();
    }
    console.log(`online templates: ${created} created, ${aliases} aliases, ${present} present, ${failures.length} failed`);
    if (failures.length) throw new AggregateError(failures.map((message) => new Error(message)), "Online template import failed; rerun to resume");
}
