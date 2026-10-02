import { z } from "zod";
import { GALLERY_SORTS, PERIODS, TAG_KINDS, TEXT_STYLES } from "./types.ts";

/** "Google Memes!" → "google-memes". Empty string when nothing usable remains. */
export function tagSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export const tagSlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40);

/** Free-form tag names, normalized to unique slugs. */
export const tagListSchema = z
  .array(z.string().max(60))
  .max(20)
  .transform((names, ctx) => {
    const slugs = [...new Set(names.map(tagSlug))];
    if (slugs.includes("")) ctx.addIssue({ code: "custom", message: "tags need at least one letter or digit" });
    return slugs.filter(Boolean);
  });

const unit = z.number().min(-1).max(2);
const time = z.number().min(0);
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const keyframeSchema = z.object({
  t: time,
  x: unit,
  y: unit,
  opacity: z.number().min(0).max(1),
});

export const textLayerSchema = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().max(2000),
    fontAssetId: z.uuid().nullable(),
    fontSize: z.number().gt(0).max(1),
    color,
    strokeColor: color,
    strokeWidth: z.number().min(0).max(0.5),
    align: z.enum(["left", "center", "right"]),
    maxWidth: z.number().gt(0).max(1),
    maxHeight: z.number().gt(0).max(1),
    textStyle: z.enum(TEXT_STYLES),
    angle: z.number().min(-360).max(360),
    x: unit,
    y: unit,
    opacity: z.number().min(0).max(1),
    start: time.nullable(),
    end: time.nullable(),
    keyframes: z.array(keyframeSchema).max(2000),
  })
  .refine((l) => l.start === null || l.end === null || l.start <= l.end, "start must be <= end")
  .transform((l) => ({ ...l, keyframes: [...l.keyframes].sort((a, b) => a.t - b.t) }));

export const layersSchema = z.array(textLayerSchema).max(50);

export const visibilitySchema = z.enum(["public", "private"]);

export const createMemeSchema = z
  .object({
    title: z.string().trim().max(200).default(""),
    templateId: z.uuid().nullable().optional(),
    sourceAssetId: z.uuid().nullable().optional(),
    /** Client-rendered result, already uploaded to storage. */
    outputAssetId: z.uuid(),
    layers: layersSchema,
    visibility: visibilitySchema.default("public"),
    post: z.boolean().default(false),
    tags: tagListSchema.default([]),
  })
  .refine((m) => Boolean(m.templateId) !== Boolean(m.sourceAssetId), "provide exactly one of templateId or sourceAssetId");

export const updateMemeSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    layers: layersSchema.optional(),
    outputAssetId: z.uuid().optional(),
    visibility: visibilitySchema.optional(),
    tags: tagListSchema.optional(),
  })
  .refine((m) => !m.layers === !m.outputAssetId, "layers and outputAssetId change together");

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  assetId: z.uuid(),
  parentId: z.uuid().nullable().optional(),
  defaultLayers: layersSchema.default([]),
  isPublic: z.boolean().default(true),
  tags: tagListSchema.default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  defaultLayers: layersSchema.optional(),
  isPublic: z.boolean().optional(),
});

export const voteSchema = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

export const sessionSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "letters, digits, _ and - only"),
});

export const galleryQuerySchema = z.object({
  period: z.enum(PERIODS).default("week"),
  sort: z.enum(GALLERY_SORTS).default("best"),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
  tag: tagSlugSchema.optional(),
});

export const hotTemplatesQuerySchema = z.object({
  period: z.enum(PERIODS).default("week"),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const templateUsageQuerySchema = z.object({
  period: z.enum(PERIODS).default("month"),
});

export const setTagsSchema = z.object({ tags: tagListSchema });

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(TAG_KINDS).default("topic"),
  description: z.string().trim().max(300).default(""),
});

export const tagsQuerySchema = z.object({
  q: z.string().trim().max(60).default(""),
  kind: z.enum(TAG_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
