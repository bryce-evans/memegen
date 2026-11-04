/**
 * Imports fonts and templates from a jacebrowning/memegen checkout.
 *
 *   ./run.sh config/dev.env seed [--limit 50]   (the checkout is SEED_TEMPLATES_FROM in the config)
 *
 * - Fonts: Impact (licensed by the project owner) plus the OFL fonts. Segoe UI, Tahoma
 *   and HG Mincho are proprietary and are skipped.
 * - Each `templates/<dir>/` becomes a top-level template from `default.(png|jpg)` (or
 *   `default.gif` when there is no still); every other image in the folder becomes a
 *   variation. Root defaults come from the catalog; variations use `config.yml`.
 * - Idempotent: assets dedupe by sha256 and templates by slug.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { newTextLayer, type Layer, type TextLayer, type TextStyle } from "@memegen/shared";
import { HttpError, type Sql } from "@memegen/server-kit";
import { assetStoreFromEnv } from "@memegen/storage";
import { insertTemplate, titleCase } from "../scripts/lib.ts";
import { checkoutAllowed, registryRisk, type Registry } from "./registry.ts";
import { manifestLayers, type ManifestFonts } from "./manifest.ts";
import { LIBRARY_FONTS } from "./fonts.ts";

/** jacebrowning's default ("thick") is swapped for Impact, the house default here. */
const DEFAULT_FONT_ALIASES: Record<string, true> = { thick: true, titilliumweb: true, "": true };

const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  khaki: "#f0e68c",
  palegoldenrod: "#eee8aa",
  maroon: "#800000",
  yellow: "#ffff00",
  red: "#ff0000",
  orange: "#ffa500",
};

interface JbText {
  style?: string;
  color?: string;
  font?: string;
  anchor_x?: number;
  anchor_y?: number;
  angle?: number;
  scale_x?: number;
  scale_y?: number;
  align?: string;
  start?: number;
  stop?: number;
}

interface JbConfig {
  name?: string;
  text?: JbText[];
  example?: (string | null)[];
}

function color(value: string | undefined): string {
  const v = (value ?? "white").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`;
  if (/^#[0-9a-f]{8}$/.test(v)) return v;
  return NAMED_COLORS[v] ?? "#ffffff";
}

function textStyle(style: string | undefined): TextStyle {
  if (style === "upper" || style === "lower" || style === "mock") return style;
  return "none";
}

function toLayers(cfg: JbConfig, fontIds: Map<string, string>, durationSec: number | null): TextLayer[] {
  const impact = fontIds.get("impact") ?? null;
  return (cfg.text ?? []).map((t, i) => {
    const scaleX = t.scale_x ?? 1;
    const scaleY = t.scale_y ?? 0.2;
    const fill = color(t.color);
    const dark = fill === "#000000";
    const alias = (t.font ?? "").toLowerCase();
    const angle = t.angle ?? 0;
    const window = (frac: number | undefined, unbounded: number) =>
      durationSec === null || frac === undefined || frac === unbounded ? null : Math.round(frac * durationSec * 1000) / 1000;
    return newTextLayer({
      text: cfg.example?.[i] ?? "",
      fontAssetId: DEFAULT_FONT_ALIASES[alias] ? impact : (fontIds.get(alias) ?? impact),
      // jacebrowning caps font size at height/9 (height/4 for rotated text) and fits to the box.
      fontSize: angle ? 1 / 4 : 1 / 9,
      color: fill,
      strokeColor: dark ? "#ffffff80" : "#000000",
      strokeWidth: dark ? 0.03 : 0.06,
      align: t.align === "left" || t.align === "right" ? t.align : "center",
      textStyle: textStyle(t.style),
      // PIL rotates counter-clockwise; our angle is clockwise.
      angle: -angle,
      x: (t.anchor_x ?? 0) + scaleX / 2,
      y: (t.anchor_y ?? 0) + scaleY / 2,
      maxWidth: Math.min(1, scaleX),
      maxHeight: Math.min(1, scaleY),
      start: window(t.start, 0),
      end: window(t.stop, 1),
    });
  });
}

async function upsertTemplate(
  sql: Sql,
  slug: string,
  fields: { name: string; assetId: string; parentId: string | null; layers: Layer[] },
): Promise<{ id: string; created: boolean }> {
  const [existing] = await sql<{ id: string; managed: boolean }[]>`
    select id, owner_id = memegen_user_id() as managed from templates where slug = ${slug}`;
  if (existing) {
    if (!existing.managed) throw new Error(`Cannot import ${slug}: slug belongs to a user template`);
    return { id: existing.id, created: false };
  }
  return { id: await insertTemplate(sql, { slug, ...fields }), created: true };
}

const MEDIA = /\.(png|jpe?g|gif|webp)$/i;

export async function importCheckout(sql: Sql, registry: Registry, root: string, limit: number): Promise<void> {
    const store = assetStoreFromEnv(sql);
    const fontIds = new Map<string, string>();
    const catalogFonts: Partial<ManifestFonts> = {};
    for (const font of LIBRARY_FONTS) {
      const data = new Uint8Array(await readFile(join(root, "fonts", font.file)));
      const asset = await store.uploadOnce({ data, filename: font.file, name: font.name, ownerId: null });
      for (const alias of font.aliases) fontIds.set(alias, asset.id);
      if (font.role) catalogFonts[font.role] = asset.id;
      console.log(`font  ${font.name}`);
    }
    if (!catalogFonts.impact || !catalogFonts.sans) throw new Error("Checkout fonts must include Impact and Noto Sans Bold");
    const fonts: ManifestFonts = { ...catalogFonts, impact: catalogFonts.impact, sans: catalogFonts.sans };

    const dirs = (await readdir(join(root, "templates"), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .filter((dir) => {
        const slug = `jb/${dir}`;
        if (registryRisk(registry, slug) === undefined) console.warn(`skip  ${slug} — no catalog entry`);
        return checkoutAllowed(registry, slug);
      })
      .slice(0, limit);

    let created = 0;
    let skipped = 0;
    for (const dir of dirs) {
      const entry = registry.catalog.find((entry) => entry.slug === `jb/${dir}`)!;
      const folder = join(root, "templates", dir);
      const cfg = parseYaml(await readFile(join(folder, "config.yml"), "utf8")) as JbConfig;
      const files = (await readdir(folder)).filter((f) => MEDIA.test(f)).sort();
      const parentFile =
        files.find((f) => /^default\.(png|jpe?g|webp)$/i.test(f)) ?? files.find((f) => /^default\./i.test(f)) ?? files[0];
      if (!parentFile) continue;
      const name = entry.title;
      const ordered = [parentFile, ...files.filter((f) => f !== parentFile)];
      let parentId: string | null = null;
      for (const file of ordered) {
        const isParent = file === parentFile;
        const stem = file.replace(/\.[^.]+$/, "");
        const label = isParent ? name : stem === "default" ? `${name} (animated)` : `${name} — ${titleCase(stem)}`;
        try {
          const data = new Uint8Array(await readFile(join(folder, file)));
          const asset = await store.uploadOnce({ data, filename: file, name: label, ownerId: null });
          const duration = asset.kind === "image" ? null : (asset.durationMs ?? 0) / 1000;
          const result = await upsertTemplate(sql, isParent ? `jb/${dir}` : `jb/${dir}/${file}`, {
            name: label,
            assetId: asset.id,
            parentId: isParent ? null : parentId,
            layers: isParent ? manifestLayers(entry, fonts, duration) : toLayers(cfg, fontIds, duration),
          });
          if (isParent) {
            parentId = result.id;
          }
          if (result.created) created++;
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
          skipped++;
          const details = Array.isArray(err.details) ? `: ${err.details.join("; ")}` : "";
          console.warn(`skip  ${dir}/${file} — ${err.message}${details}`);
          if (isParent) break;
        }
      }
    }
    console.log(`templates: ${created} created, ${skipped} skipped, ${dirs.length} folders scanned`);
}
