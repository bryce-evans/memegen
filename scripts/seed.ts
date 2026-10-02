/**
 * Imports fonts and templates from a jacebrowning/memegen checkout.
 *
 *   bun run seed -- --from /path/to/jacebrowning-memegen [--limit 50]
 *
 * - Fonts: Impact (licensed by the project owner) plus the OFL fonts. Segoe UI, Tahoma
 *   and HG Mincho are proprietary and are skipped.
 * - Each `templates/<dir>/` becomes a top-level template from `default.(png|jpg)` (or
 *   `default.gif` when there is no still); every other image in the folder becomes a
 *   variation. Text boxes from `config.yml` become `defaultLayers`.
 * - Idempotent: assets dedupe by sha256 and templates by slug.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { newTextLayer, type Asset, type TextLayer, type TextStyle } from "@memegen/shared";
import { createSql, HttpError, migrate, uploadLimitsFromEnv, type Sql } from "@memegen/server-kit";
import { AssetStore, createProviders, findAssetRow, toAsset } from "@memegen/storage";
import { createHash } from "node:crypto";

const { values } = parseArgs({
  options: { from: { type: "string" }, limit: { type: "string" } },
});
if (!values.from) {
  console.error("usage: bun run seed -- --from <path to jacebrowning/memegen checkout> [--limit N]");
  process.exit(1);
}
const ROOT = values.from;
const LIMIT = values.limit ? Number(values.limit) : Infinity;

const FONTS: { file: string; name: string; aliases: string[] }[] = [
  { file: "Impact.ttf", name: "Impact", aliases: ["impact"] },
  { file: "TitilliumWeb-Black.ttf", name: "Titillium Web Black", aliases: ["thick", "titilliumweb"] },
  { file: "TitilliumWeb-SemiBold.ttf", name: "Titillium Web SemiBold", aliases: ["thin", "titilliumweb-thin"] },
  { file: "NotoSans-Bold.ttf", name: "Noto Sans Bold", aliases: ["notosans", "tiny", "segoe", "jp", "hgminchob"] },
  { file: "Kalam-Regular.ttf", name: "Kalam", aliases: ["comic", "kalam"] },
  { file: "NotoSansHebrew-Bold.ttf", name: "Noto Sans Hebrew Bold", aliases: ["he", "notosanshebrew"] },
];

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

export function toLayers(cfg: JbConfig, fontIds: Map<string, string>, durationSec: number | null): TextLayer[] {
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

async function importFile(store: AssetStore, sql: Sql, path: string, name: string): Promise<Asset> {
  const data = new Uint8Array(await readFile(path));
  const sha = createHash("sha256").update(data).digest("hex");
  const [existing] = await sql<{ id: string }[]>`select id from assets where sha256 = ${sha} limit 1`;
  if (existing) return toAsset((await findAssetRow(sql, existing.id))!);
  return store.upload({ data, filename: path.split("/").pop()!, name, ownerId: null });
}

async function upsertTemplate(
  sql: Sql,
  slug: string,
  fields: { name: string; assetId: string; parentId: string | null; layers: TextLayer[] },
): Promise<{ id: string; created: boolean }> {
  const [existing] = await sql<{ id: string }[]>`select id from templates where slug = ${slug}`;
  if (existing) return { id: existing.id, created: false };
  const [row] = await sql<{ id: string }[]>`
    insert into templates ${sql({
      slug,
      name: fields.name,
      asset_id: fields.assetId,
      parent_id: fields.parentId,
      default_layers: sql.json(fields.layers as never),
      is_public: true,
    })} returning id`;
  return { id: row!.id, created: true };
}

const MEDIA = /\.(png|jpe?g|gif|webp)$/i;

function titleCase(stem: string): string {
  return stem.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  const sql = createSql();
  await migrate(sql);
  const store = new AssetStore(sql, createProviders(process.env.STORAGE_PROVIDER || "local"), uploadLimitsFromEnv());

  const fontIds = new Map<string, string>();
  for (const font of FONTS) {
    const asset = await importFile(store, sql, join(ROOT, "fonts", font.file), font.name);
    for (const alias of font.aliases) fontIds.set(alias, asset.id);
    console.log(`font  ${font.name}`);
  }

  const dirs = (await readdir(join(ROOT, "templates"), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .slice(0, LIMIT);

  let created = 0;
  let skipped = 0;
  for (const dir of dirs) {
    const folder = join(ROOT, "templates", dir);
    const cfg = parseYaml(await readFile(join(folder, "config.yml"), "utf8")) as JbConfig;
    const files = (await readdir(folder)).filter((f) => MEDIA.test(f)).sort();
    const parentFile =
      files.find((f) => /^default\.(png|jpe?g|webp)$/i.test(f)) ?? files.find((f) => /^default\./i.test(f)) ?? files[0];
    if (!parentFile) continue;
    const name = cfg.name?.trim() || titleCase(dir);
    const ordered = [parentFile, ...files.filter((f) => f !== parentFile)];
    let parentId: string | null = null;
    for (const file of ordered) {
      const isParent = file === parentFile;
      const stem = file.replace(/\.[^.]+$/, "");
      const label = isParent ? name : stem === "default" ? `${name} (animated)` : `${name} — ${titleCase(stem)}`;
      try {
        const asset = await importFile(store, sql, join(folder, file), label);
        const duration = asset.kind === "image" ? null : (asset.durationMs ?? 0) / 1000;
        const result = await upsertTemplate(sql, isParent ? `jb/${dir}` : `jb/${dir}/${file}`, {
          name: label,
          assetId: asset.id,
          parentId: isParent ? null : parentId,
          layers: toLayers(cfg, fontIds, duration),
        });
        if (isParent) {
          parentId = result.id;
          // Classic image macros; variations and memes inherit the tag through the match views.
          await sql`
            insert into template_tags (template_id, tag_id)
            select ${result.id}, id from tags where slug = 'oldschool'
            on conflict do nothing`;
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
  await sql.end();
}

if (import.meta.main) await main();
