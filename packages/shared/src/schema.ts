import { z } from "zod";
import { COMMENT_MAX_LENGTH, LAYER_NAME_MAX_LENGTH, MAX_PACK_IMAGES, MAX_PANELS, MAX_TAGS, TEXT_MAX_LENGTH } from "./limits.ts";
import { PANEL_FONT_SIZE_DEFAULT, PANEL_FONT_SIZE_MAX, PANEL_FONT_SIZE_MIN } from "./panels.ts";
import { ANCHOR_Y_MIN, TOP_SECTION_HEIGHT_MAX, TOP_SECTION_HEIGHT_MIN } from "./section.ts";
import {
  GALLERY_SORTS,
  LEADERBOARD_SORTS,
  PANEL_LAYOUTS,
  PERIODS,
  RESERVED_USERNAMES,
  TAG_KINDS,
  TEMPLATE_KINDS,
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
/** Anchor y also reaches into the top section's band above the media. */
const anchorY = z.number().min(ANCHOR_Y_MIN).max(2);
const time = z.number().min(0);
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const keyframeSchema = z.object({
  /** Seconds from the start of the media. */
  t: time,
  /** Anchor (box center) as a fraction of media width/height. */
  x: unit,
  y: anchorY,
  /** 0..1 */
  opacity: z.number().min(0).max(1),
});

/** What every layer kind has: identity, placement, rotation, opacity, visibility window, and keyframes. */
const layerFields = {
  id: z.string().min(1).max(64),
  /** Editor label ("Top text", "Panel 1"), named in the template editor; never drawn. Absent on older layers. */
  name: z.string().max(LAYER_NAME_MAX_LENGTH).optional(),
  /** Clockwise rotation in degrees around the box center. */
  angle: z.number().min(-360).max(360),
  /** Static anchor (box center, fractions of media width/height) and opacity, used when `keyframes` is empty. */
  x: unit,
  y: anchorY,
  opacity: z.number().min(0).max(1),
  /** Visibility window in seconds; null = unbounded. */
  start: time.nullable(),
  end: time.nullable(),
  /** Sorted by `t`; when non-empty, overrides x/y/opacity with linear interpolation. */
  keyframes: z.array(keyframeSchema).max(2000),
};

export const textLayerSchema = z.object({
  type: z.literal("text"),
  ...layerFields,
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
  /**
   * Set on the one top-section layer: a white band `height` (fraction of the media width) tall above the media holds
   * this text, whose x/y, box, and font size are then fractions of the band.
   */
  topSection: z.object({ height: z.number().min(TOP_SECTION_HEIGHT_MIN).max(TOP_SECTION_HEIGHT_MAX) }).optional(),
});

/** An uploaded or pasted still image drawn over the media, at its own aspect ratio. */
export const imageLayerSchema = z.object({
  type: z.literal("image"),
  ...layerFields,
  /** A still image asset. */
  assetId: z.uuid(),
  /** Drawn width as a fraction of media width; the height follows the image's aspect ratio. */
  width: z.number().gt(0).max(2),
});

export const layerSchema = z
  .discriminatedUnion("type", [textLayerSchema, imageLayerSchema])
  .refine((l) => l.start === null || l.end === null || l.start <= l.end, "start must be <= end")
  .transform((l) => ({ ...l, keyframes: [...l.keyframes].sort((a, b) => a.t - b.t) }));

export const layersSchema = z
  .array(layerSchema)
  .max(50)
  .refine((ls) => ls.filter((l) => l.type === "text" && l.topSection).length <= 1, "only one layer can be the top section");

export const panelSchema = z.object({
  id: z.string().min(1).max(64),
  /** An image from the template's pack. */
  assetId: z.uuid(),
  text: z.string().max(TEXT_MAX_LENGTH),
});

export const panelSetSchema = z.object({
  layout: z.enum(PANEL_LAYOUTS),
  /** Black rules around every caption and image; false draws the panels without them. */
  grid: z.boolean().default(true),
  /** Max caption font size for every panel, in units (`panelTextLayer`). */
  fontSize: z.number().min(PANEL_FONT_SIZE_MIN).max(PANEL_FONT_SIZE_MAX).default(PANEL_FONT_SIZE_DEFAULT),
  panels: z.array(panelSchema).min(1).max(MAX_PANELS),
});

/** A multi-panel template as written: pack images by id (in order) and the panels the editor starts with. */
export const panelTemplateInputSchema = z
  .object({
    layout: z.enum(PANEL_LAYOUTS),
    grid: z.boolean().default(true),
    fontSize: z.number().min(PANEL_FONT_SIZE_MIN).max(PANEL_FONT_SIZE_MAX).default(PANEL_FONT_SIZE_DEFAULT),
    packAssetIds: z
      .array(z.uuid())
      .min(1)
      .max(MAX_PACK_IMAGES)
      .refine((ids) => new Set(ids).size === ids.length, "pack images must be distinct"),
    defaultPanels: z.array(panelSchema).min(1).max(MAX_PANELS),
  })
  .refine((p) => p.defaultPanels.every((d) => p.packAssetIds.includes(d.assetId)), "default panels must use images from the pack");

export const visibilitySchema = z.enum(VISIBILITIES);

/** Every meme is made from an existing template. */
export const createMemeSchema = z
  .object({
    title: z.string().trim().max(200).default(""),
    templateId: z.uuid(),
    /** Client-rendered result, already uploaded to storage. */
    outputAssetId: z.uuid(),
    layers: layersSchema,
    /** Required for multi-panel templates (with no layers), null otherwise. */
    panels: panelSetSchema.nullable().default(null),
    visibility: visibilitySchema.default("public"),
    post: z.boolean().default(false),
    tags: tagListSchema.default([]),
  })
  .refine((m) => !m.panels || !m.layers.length, "multi-panel memes have no text layers");

export const updateMemeSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    layers: layersSchema.optional(),
    panels: panelSetSchema.nullable().optional(),
    outputAssetId: z.uuid().optional(),
    visibility: visibilitySchema.optional(),
    tags: tagListSchema.optional(),
  })
  .refine((m) => !m.layers === !m.outputAssetId, "layers and outputAssetId change together")
  .refine((m) => m.panels === undefined || m.layers !== undefined, "panels change together with layers and outputAssetId")
  .refine((m) => !m.panels || !m.layers?.length, "multi-panel memes have no text layers");

export const createTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** The media; for a multi-panel template, its rendered cover. */
    assetId: z.uuid(),
    parentId: z.uuid().nullable().optional(),
    defaultLayers: layersSchema.default([]),
    panels: panelTemplateInputSchema.nullable().default(null),
    isPublic: z.boolean().default(true),
    tags: tagListSchema.default([]),
  })
  .refine((t) => !t.panels || !t.defaultLayers.length, "multi-panel templates have no text layers");

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    defaultLayers: layersSchema.optional(),
    /** Multi-panel templates only; comes with `assetId`, the cover re-rendered from the new defaults. */
    panels: panelTemplateInputSchema.optional(),
    assetId: z.uuid().optional(),
    isPublic: z.boolean().optional(),
  })
  .refine((t) => !t.panels === !t.assetId, "panels and assetId change together");

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
  kind: z.enum(TEMPLATE_KINDS).optional(),
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

export const createStickerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** An uploaded PNG, at most `STICKER_MAX_DIMENSION` on each edge. */
  assetId: z.uuid(),
});

export const stickersQuerySchema = pageQuerySchema(60, 200);
