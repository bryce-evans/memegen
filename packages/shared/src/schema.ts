import { z } from "zod";
import { COMMENT_MAX_LENGTH, MAX_TAGS, TEXT_MAX_LENGTH } from "./limits.ts";
import {
  GALLERY_SORTS,
  LEADERBOARD_SORTS,
  PERIODS,
  RESERVED_USERNAMES,
  TAG_KINDS,
  TEXT_ALIGNS,
  TEXT_STYLES,
  VISIBILITIES,
} from "./types.ts";

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
  .max(MAX_TAGS)
  .transform((names, ctx) => {
    const slugs = [...new Set(names.map(tagSlug))];
    if (slugs.includes("")) ctx.addIssue({ code: "custom", message: "tags need at least one letter or digit" });
    return slugs.filter(Boolean);
  });

const unit = z.number().min(-1).max(2);
const time = z.number().min(0);
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const keyframeSchema = z.object({
  /** Seconds from the start of the media. */
  t: time,
  /** Anchor (box center) as a fraction of media width/height. */
  x: unit,
  y: unit,
  /** 0..1 */
  opacity: z.number().min(0).max(1),
});

export const textLayerSchema = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().max(TEXT_MAX_LENGTH),
    /** Font asset; null uses the fallback family. */
    fontAssetId: z.uuid().nullable(),
    /** Max font size as a fraction of media height; text shrinks to fit the box. */
    fontSize: z.number().gt(0).max(1),
    color,
    strokeColor: color,
    /** Stroke width as a fraction of the font size. */
    strokeWidth: z.number().min(0).max(0.5),
    align: z.enum(TEXT_ALIGNS),
    /** Text box size as fractions of media width/height; wraps at width, shrinks to fit. */
    maxWidth: z.number().gt(0).max(1),
    maxHeight: z.number().gt(0).max(1),
    textStyle: z.enum(TEXT_STYLES),
    /** Clockwise rotation in degrees around the box center. */
    angle: z.number().min(-360).max(360),
    /** Static anchor/opacity, used when `keyframes` is empty. */
    x: unit,
    y: unit,
    opacity: z.number().min(0).max(1),
    /** Visibility window in seconds; null = unbounded. */
    start: time.nullable(),
    end: time.nullable(),
    /** Sorted by `t`; when non-empty, overrides x/y/opacity with linear interpolation. */
    keyframes: z.array(keyframeSchema).max(2000),
  })
  .refine((l) => l.start === null || l.end === null || l.start <= l.end, "start must be <= end")
  .transform((l) => ({ ...l, keyframes: [...l.keyframes].sort((a, b) => a.t - b.t) }));

export const layersSchema = z.array(textLayerSchema).max(50);

export const visibilitySchema = z.enum(VISIBILITIES);

/** Every meme is made from an existing template. */
export const createMemeSchema = z.object({
  title: z.string().trim().max(200).default(""),
  templateId: z.uuid(),
  /** Client-rendered result, already uploaded to storage. */
  outputAssetId: z.uuid(),
  layers: layersSchema,
  visibility: visibilitySchema.default("public"),
  post: z.boolean().default(false),
  tags: tagListSchema.default([]),
});

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

export const favoriteSchema = z.object({ favorite: z.boolean() });

export const sessionSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "letters, digits, _ and - only")
    .refine((name) => !RESERVED_USERNAMES.includes(name.toLowerCase()), "that username is reserved"),
});

/** `?limit=` as sent in a query string. */
function limitSchema(defaultLimit: number, maxLimit: number) {
  return z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit);
}

/** `?offset=&limit=` for paginated lists. */
export function pageQuerySchema(defaultLimit = 24, maxLimit = 100) {
  return z.object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: limitSchema(defaultLimit, maxLimit),
  });
}

export const templatesQuerySchema = pageQuerySchema().extend({
  q: z.string().trim().max(100).default(""),
  tag: tagSlugSchema.optional(),
});

export const commentsQuerySchema = pageQuerySchema(50);

export const galleryQuerySchema = pageQuerySchema().extend({
  period: z.enum(PERIODS).default("week"),
  sort: z.enum(GALLERY_SORTS).default("best"),
  tag: tagSlugSchema.optional(),
});

export const hotTemplatesQuerySchema = z.object({
  period: z.enum(PERIODS).default("week"),
  limit: limitSchema(12, 50),
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
  limit: limitSchema(100, 200),
});

export const leaderboardQuerySchema = z.object({
  by: z.enum(LEADERBOARD_SORTS).default("hScore"),
  limit: limitSchema(50, 100),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  /** Reply to this top-level comment on the same meme. */
  parentId: z.uuid().nullable().optional(),
});
