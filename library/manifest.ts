import { z } from "zod";
import {
  layersSchema,
  newTextLayer,
  newTopSectionLayer,
  tagSlug,
  TEMPLATE_NAME_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
  type Layer,
} from "@memegen/shared";
import { CATALOG_FONT_ROLES, type CatalogFontRole } from "./fonts.ts";

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "URL must use HTTPS");
const fraction = z.number().min(0).max(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const manifestTextSchema = z.object({
  text: z.string().max(TEXT_MAX_LENGTH),
  x: fraction,
  y: fraction,
  maxWidth: z.number().gt(0).max(1),
  maxHeight: z.number().gt(0).max(1),
  fontSize: z.number().gt(0).max(1).optional(),
  font: z.enum(CATALOG_FONT_ROLES).optional(),
  color: color.optional(),
  strokeColor: color.optional(),
  strokeWidth: z.number().min(0).max(0.5).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  textStyle: z.enum(["none", "upper", "lower", "mock"]).optional(),
  angle: z.number().min(-360).max(360).optional(),
  start: fraction.optional(),
  end: fraction.optional(),
}).strict().superRefine((box, ctx) => {
  const epsilon = 1e-9;
  if (box.x - box.maxWidth / 2 < -epsilon || box.x + box.maxWidth / 2 > 1 + epsilon) {
    ctx.addIssue({ code: "custom", path: ["x"], message: "text box must fit within image width" });
  }
  if (box.y - box.maxHeight / 2 < -epsilon || box.y + box.maxHeight / 2 > 1 + epsilon) {
    ctx.addIssue({ code: "custom", path: ["y"], message: "text box must fit within image height" });
  }
  if (box.start !== undefined && box.end !== undefined && box.start >= box.end) {
    ctx.addIssue({ code: "custom", path: ["end"], message: "caption end must follow start" });
  }
});

export const riskSchema = z.number().int().min(1).max(5);
export const ratingTagsSchema = z.array(z.string().min(1).max(40).regex(/^[a-z]+(?:-[a-z]+)*$/)).min(1).max(12)
  .refine((tags) => new Set(tags).size === tags.length, "rating tags must be unique");

export const manifestTemplateSchema = z.object({
  slug: z.string().regex(/^(?:online\/[a-z0-9]+|jb\/[a-z0-9_-]+)$/),
  title: z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH),
  url: httpsUrl,
  source: httpsUrl,
  tags: z.array(z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH).refine((value) => !!tagSlug(value), "tag needs letters or digits")),
  risk: riskSchema,
  rating_tags: ratingTagsSchema,
  layout: z.enum(["impact", "comment", "subtitle", "labels"]),
  text: z.array(manifestTextSchema).min(1).max(50),
}).strict().refine((entry) => entry.layout !== "comment" || entry.text.length === 1, {
  path: ["text"], message: "comment layout requires exactly one top-section caption",
});

export const templateManifestSchema = z.object({
  version: z.literal(1),
  sources: z.array(z.object({ name: z.string().trim().min(1), url: httpsUrl }).strict()).min(1),
  templates: z.array(manifestTemplateSchema),
}).strict().superRefine((manifest, ctx) => {
  const slugs = new Set<string>();
  const urls = new Set<string>();
  manifest.templates.forEach((entry, index) => {
    if (slugs.has(entry.slug)) ctx.addIssue({ code: "custom", path: ["templates", index, "slug"], message: "duplicate template slug" });
    const url = new URL(entry.url).href;
    if (urls.has(url)) ctx.addIssue({ code: "custom", path: ["templates", index, "url"], message: "duplicate image URL" });
    slugs.add(entry.slug);
    urls.add(url);
  });
});

export type ManifestTemplate = z.infer<typeof manifestTemplateSchema>;
export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type ManifestFonts = Pick<Record<CatalogFontRole, string>, "impact" | "sans">
  & Partial<Record<CatalogFontRole, string>>;

/** Convert catalog coordinates to native, validated editor layers. */
export function manifestLayers(entry: ManifestTemplate, fonts: ManifestFonts, durationSec: number | null = null): Layer[] {
  const window = (fraction: number | undefined, unbounded: number) =>
    durationSec === null || fraction === undefined || fraction === unbounded ? null : Math.round(fraction * durationSec * 1000) / 1000;
  const layers = entry.text.map((box) => {
    const { font, start, end, ...overrides } = box;
    const timing = { start: window(start, 0), end: window(end, 1) };
    const fontName = font ?? (entry.layout === "impact" ? "impact" : "sans");
    const fontAssetId = fonts[fontName];
    if (!fontAssetId && (entry.layout !== "comment" || font)) throw new Error(`Missing catalog font: ${fontName}`);
    if (entry.layout === "comment") {
      const section = newTopSectionLayer();
      return { ...section, ...overrides, ...timing, fontAssetId: font ? fontAssetId! : section.fontAssetId };
    }
    const impact = entry.layout === "impact";
    return newTextLayer({
      fontAssetId: fontAssetId!,
      fontSize: impact ? 1 / 9 : 0.065,
      color: entry.layout === "subtitle" ? "#f5f2a6" : "#ffffff",
      strokeColor: "#000000",
      strokeWidth: impact ? 0.08 : 0.05,
      textStyle: impact ? "upper" : "none",
      ...overrides,
      ...timing,
    });
  });
  return layersSchema.parse(layers);
}
