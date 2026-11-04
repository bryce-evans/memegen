import { readFile } from "node:fs/promises";
import { z } from "zod";
import { tagSlug, TAG_NAME_MAX_LENGTH } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";
import { tagTemplate, upsertTag } from "../scripts/lib.ts";
import { templateManifestSchema, riskSchema, ratingTagsSchema, type ManifestTemplate } from "./manifest.ts";

const aliasSchema = z.object({ slug: z.string(), title: z.string(), tags: z.array(z.string()), risk: riskSchema, rating_tags: ratingTagsSchema });
const policySchema = z.object({
  version: z.literal(1),
  duplicates: z.array(z.object({ slug: z.string(), canonicalSlug: z.string() })),
  aliases: z.array(aliasSchema),
}).strict();
export type RegistryPolicy = z.infer<typeof policySchema>;
type Alias = Pick<z.infer<typeof aliasSchema>, "slug" | "title" | "tags">;
export interface Registry {
  policy: RegistryPolicy;
  catalog: ManifestTemplate[];
  selected: ManifestTemplate[];
  maxRisk: number;
  checkoutEnabled: boolean;
  onlineEnabled: boolean;
}

export async function loadRegistry(options: { manifest?: string; checkoutEnabled?: boolean } = {}): Promise<Registry> {
  const configuredRisk = process.env.SEED_MAX_RISK ?? "3";
  if (!/^[1-5]$/.test(configuredRisk)) throw new Error("SEED_MAX_RISK must be an integer from 1 to 5");
  const maxRisk = Number(configuredRisk);
  const load = async (file: string) => templateManifestSchema.parse(JSON.parse(await readFile(file, "utf8"))).templates;
  const policy = policySchema.parse(JSON.parse(await readFile("library/REGISTRY_POLICY.json", "utf8")));
  const duplicates = new Map(policy.duplicates.map((entry) => [entry.slug, entry.canonicalSlug]));
  if (duplicates.size !== policy.duplicates.length || policy.duplicates.some((entry) => entry.slug === entry.canonicalSlug || duplicates.has(entry.canonicalSlug))) {
    throw new Error("Registry duplicates must have unique slugs and terminal canonical targets");
  }
  const builtins = await load("library/MANIFEST.json");
  const builtinSlugs = new Set(builtins.map((entry) => entry.slug));
  if (policy.duplicates.some((entry) => !builtinSlugs.has(entry.canonicalSlug) || builtinSlugs.has(entry.slug))) {
    throw new Error("Registry duplicates must retire catalog slugs to existing builtin canonicals");
  }
  const manifest = options.manifest ?? process.env.SEED_TEMPLATE_MANIFEST ?? "library/MANIFEST.json";
  const candidates = !manifest ? [] : manifest === "library/MANIFEST.json" ? builtins : await load(manifest);
  // Keep rejected custom entries known so reconciliation also hides previously imported rows.
  const bySlug = new Map(builtins.map((entry) => [entry.slug, entry]));
  for (const entry of candidates) {
    const known = bySlug.get(entry.slug);
    const aliasRisk = policy.aliases.find((alias) => alias.slug === entry.slug)?.risk ?? 1;
    const risk = Math.max(entry.risk, aliasRisk);
    if (!known || risk > known.risk) bySlug.set(entry.slug, risk === entry.risk ? entry : { ...entry, risk });
  }
  const catalog = [...bySlug.values()];
  const selected = candidates.filter((entry) => bySlug.get(entry.slug)!.risk <= maxRisk);
  return {
    policy, catalog, selected, maxRisk,
    checkoutEnabled: options.checkoutEnabled ?? !!process.env.SEED_TEMPLATES_FROM,
    onlineEnabled: !!manifest,
  };
}

export function registryRisk(registry: Registry, slug: string): number | undefined {
  return registry.catalog.find((entry) => entry.slug === slug)?.risk
    ?? registry.policy.aliases.find((entry) => entry.slug === slug)?.risk;
}

export function checkoutAllowed(registry: Registry, slug: string): boolean {
  const risk = registryRisk(registry, slug);
  return slug.startsWith("jb/") && risk !== undefined && risk <= registry.maxRisk && !duplicateCanonical(registry, slug);
}

export function duplicateCanonical(registry: Registry, slug: string): string | undefined {
  return registry.policy.duplicates.find((entry) => entry.slug === slug)?.canonicalSlug;
}

export function aliasTags(entry: Alias): string[] {
  return [...new Set([...entry.tags, entry.title, entry.slug].map((name) => tagSlug(name.slice(0, TAG_NAME_MAX_LENGTH))).filter(Boolean))];
}

export async function addRegistryAliases(sql: Sql, id: string, entry: Alias): Promise<void> {
  for (const rawName of [...entry.tags, entry.title, entry.slug]) {
    const name = rawName.slice(0, TAG_NAME_MAX_LENGTH);
    const slug = tagSlug(name);
    if (!slug) continue;
    await upsertTag(sql, { slug, name, kind: "topic", createdBy: null });
    await tagTemplate(sql, id, [slug]);
  }
}

interface ManagedRoot { id: string; slug: string | null; name: string; identities: string[] }

/** Direct canonical identity wins over legacy aliases, regardless of the configured threshold. */
export function rootVisibility(registry: Registry, root: ManagedRoot): boolean | undefined {
  const { policy } = registry;
  if (root.slug && duplicateCanonical(registry, root.slug)) return false;
  const visibility = (risk: number, enabled: boolean) => risk > registry.maxRisk ? false : enabled ? true : undefined;
  const direct = root.slug;
  if (direct?.startsWith("jb/")) {
    const risk = registryRisk(registry, direct);
    return risk === undefined ? false : visibility(risk, registry.checkoutEnabled || registry.onlineEnabled);
  }
  if (direct) {
    const risk = registryRisk(registry, direct);
    if (risk !== undefined) return visibility(risk, registry.onlineEnabled);
  }
  // Only stable catalog identities count; ordinary matching title/topic tags do not claim custom templates.
  const hasIdentity = (slug: string) => root.identities.includes(tagSlug(slug));
  if (policy.duplicates.some((entry) => hasIdentity(entry.slug))) return false;
  const matches = [...registry.catalog, ...policy.aliases].filter((entry) => hasIdentity(entry.slug));
  if (matches.length) {
    const risk = Math.min(...matches.map((entry) => entry.risk));
    const enabled = matches.some((entry) => entry.risk === risk && (registry.onlineEnabled || (entry.slug.startsWith("jb/") && registry.checkoutEnabled)));
    return visibility(risk, enabled);
  }
  return undefined;
}

/** Updates visibility and seed aliases only. Template IDs, hierarchy, assets, defaults and saved memes stay intact. */
export async function reconcileRegistry(sql: Sql, registry: Registry): Promise<void> {
  const roots = await sql<ManagedRoot[]>`
    select t.id, t.slug, t.name,
      coalesce(array_agg(g.slug) filter (where g.slug like 'online-%' or g.slug like 'jb-%'), '{}') as identities
    from templates t
    left join template_tags tt on tt.template_id = t.id and tt.base
    left join tags g on g.id = tt.tag_id
    where t.parent_id is null and t.owner_id = memegen_user_id()
    group by t.id`;
  const metadata = [...registry.catalog, ...registry.policy.aliases];
  const publicRoots: string[] = [];
  const unlistedRoots: string[] = [];
  const ratedRoots = new Map<number, string[]>();
  for (const root of roots) {
    const visible = rootVisibility(registry, root);
    if (visible !== undefined) (visible ? publicRoots : unlistedRoots).push(root.id);
    const risk = root.slug ? registryRisk(registry, root.slug) : undefined;
    if (risk !== undefined) {
      const ids = ratedRoots.get(risk) ?? [];
      ids.push(root.id);
      ratedRoots.set(risk, ids);
    }
  }
  for (const [visible, ids] of [[true, publicRoots], [false, unlistedRoots]] as const) {
    if (!ids.length) continue;
    await sql`update templates set is_public = ${visible}
      where owner_id = memegen_user_id() and (id in ${sql(ids)} or parent_id in ${sql(ids)})
        and is_public is distinct from ${visible}`;
  }
  for (const [risk, ids] of ratedRoots) {
    const allowedTags = new Set(metadata.filter((entry) => entry.risk <= risk).flatMap(aliasTags));
    const higherRiskTags = [...new Set(metadata.filter((entry) => entry.risk > risk).flatMap(aliasTags))].filter((slug) => !allowedTags.has(slug));
    if (!higherRiskTags.length) continue;
    // Only seed-created associations may be cleaned; user-added tags are never removed.
    await sql`delete from template_tags tt using tags g
      where tt.template_id in ${sql(ids)} and tt.tag_id = g.id and tt.base
        and tt.added_by is null and g.created_by is null and g.slug in ${sql(higherRiskTags)}`;
  }
  const bySlug = new Map(roots.filter((root) => root.slug).map((root) => [root.slug!, root]));
  for (const entry of registry.catalog) {
    const root = bySlug.get(entry.slug);
    if (root && entry.risk <= registry.maxRisk && !duplicateCanonical(registry, entry.slug)) {
      await addRegistryAliases(sql, root.id, entry);
    }
  }
  for (const duplicate of registry.policy.duplicates) {
    const canonical = bySlug.get(duplicate.canonicalSlug);
    if (!canonical) continue;
    const canonicalRisk = registryRisk(registry, duplicate.canonicalSlug);
    const aliasRisk = registryRisk(registry, duplicate.slug);
    if (canonicalRisk === undefined || aliasRisk === undefined || aliasRisk > canonicalRisk || canonicalRisk > registry.maxRisk) continue;
    const old = bySlug.get(duplicate.slug);
    const entry = metadata.find((entry) => entry.slug === duplicate.slug);
    if (entry) await addRegistryAliases(sql, canonical.id, entry);
    else await addRegistryAliases(sql, canonical.id, { slug: duplicate.slug, title: old?.name ?? duplicate.slug, tags: [] });
  }
}
