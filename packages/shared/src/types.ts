import type { z } from "zod";
import type { imageLayerSchema, keyframeSchema, panelSchema, panelSetSchema, textLayerSchema } from "./schema.ts";

export const ASSET_KINDS = ["image", "gif", "video", "font"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export type MediaKind = Exclude<AssetKind, "font">;

/** Stored file metadata, owned by the storage service. */
export interface Asset {
  id: string;
  kind: AssetKind;
  mime: string;
  filename: string;
  sizeBytes: number;
  provider: string;
  ownerId: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  frameCount: number | null;
  fps: number | null;
  /** Display name (fonts: family label, e.g. "Impact"). */
  name: string;
  createdAt: string;
  /** Path on the storage service; the web app reaches it under `/storage`. */
  contentPath: string;
}

/** Storage service route serving an asset's bytes (`Asset.contentPath`); the web app reaches it under `/storage`. */
export function assetContentPath(id: string): string {
  return `/assets/${id}/content`;
}

export type Keyframe = z.output<typeof keyframeSchema>;

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];
export const TEXT_STYLES = ["upper", "lower", "none", "mock"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

/** Field docs live on `textLayerSchema`, the single definition. */
export type TextLayer = z.output<typeof textLayerSchema>;
/** A still image over the media (uploaded or pasted); field docs on `imageLayerSchema`. */
export type ImageLayer = z.output<typeof imageLayerSchema>;
/** Anything drawn over a single image/GIF/video meme, in order (later on top). */
export type Layer = TextLayer | ImageLayer;

/**
 * Every template's kind, fixed when it is created; each has its own editor. `single` = one still image with text
 * boxes, `gif` = a GIF or video with (animated) text boxes, `multi` = multi-panel (image pack). Also the
 * `GET /api/templates?kind=` filter.
 */
export const TEMPLATE_KINDS = ["single", "multi", "gif"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Multi-panel memes: `vertical` stacks rows (text left of each image), `horizontal` lines up columns (text above). */
export const PANEL_LAYOUTS = ["vertical", "horizontal"] as const;
export type PanelLayout = (typeof PANEL_LAYOUTS)[number];
/** One panel of a multi-panel meme: an image from its template's pack plus the panel's text. */
export type Panel = z.output<typeof panelSchema>;
/** A multi-panel meme's content (stored on the meme; `layers` is empty). */
export type PanelSet = z.output<typeof panelSetSchema>;

/** What makes a template multi-panel: its image pack and the panels the editor starts with. */
export interface PanelTemplate {
  layout: PanelLayout;
  /** Whether the default panels show the black grid rules (`PanelSet.grid`). */
  grid: boolean;
  /** Default max caption font size (`PanelSet.fontSize`). */
  fontSize: number;
  /** Still images in pack order; panels pick from these. */
  pack: Asset[];
  defaultPanels: Panel[];
}

export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface UserStats {
  memeCount: number;
  highScore: number;
  hScore: number;
}

export interface InternalUserStats extends UserStats {
  negativeHScore: number;
}

/** `/api/me` and `/api/users/:username`. */
export interface UserProfile {
  user: User;
  stats: UserStats;
  /** Public templates (including variations) this user added. */
  templateCount: number;
}

/** Reserved account that authors built-in (seeded) templates; nobody can sign in as it. */
export const SYSTEM_USERNAME = "memegen";
export const RESERVED_USERNAMES: readonly string[] = [SYSTEM_USERNAME];

export const LEADERBOARD_SORTS = ["hScore", "highScore", "memeCount"] as const;
export type LeaderboardSort = (typeof LEADERBOARD_SORTS)[number];

export interface LeaderboardEntry {
  /** 1-based position in the requested ordering. */
  rank: number;
  user: Pick<User, "id" | "username">;
  stats: UserStats;
}

export interface Comment {
  id: string;
  memeId: string;
  /** Top-level comments are null; replies point at a top-level comment (one level of threading). */
  parentId: string | null;
  author: Pick<User, "id" | "username">;
  /** Empty when `deleted`. */
  body: string;
  /** Deleted comments that still have replies stay as placeholders so the thread keeps its shape. */
  deleted: boolean;
  createdAt: string;
  /** Only populated on top-level comments, oldest first. */
  replies: Comment[];
}

export interface Template {
  id: string;
  name: string;
  parentId: string | null;
  /** Fixed at creation; decides the editor (`multi` opens the panel editor). */
  kind: TemplateKind;
  /** Who added it ("added by"); built-in templates belong to the reserved `memegen` account. */
  owner: Pick<User, "id" | "username">;
  asset: Asset;
  /** Empty for multi-panel templates. */
  defaultLayers: Layer[];
  /** Set for multi-panel templates; `asset` is then a rendered cover of `defaultPanels`. */
  panels: PanelTemplate | null;
  isPublic: boolean;
  createdAt: string;
  /** Only populated on top-level templates. */
  variations: Template[];
  /** All-time memes created from this template (top-level: including its variations). */
  useCount: number;
  /** Tag slugs placed directly on this template: its base tags plus tags users added. */
  tags: string[];
  /** Tags set by the template's author when it was added; always kept, others can only add more. */
  baseTags: string[];
}

/**
 * A small PNG anyone can drop on a meme as an image layer (the Layers panel's Sticker button); its `asset` is what
 * layers reference.
 */
export interface Sticker {
  id: string;
  name: string;
  /** Who added it; built-in stickers belong to the reserved `memegen` account. */
  owner: Pick<User, "id" | "username">;
  asset: Asset;
  createdAt: string;
  /** All-time posted memes carrying it (each meme once, however often it places the sticker); the picker ranks by it. */
  useCount: number;
  /** All-time saved memes carrying it (posted or not); breaks `useCount` ties. */
  savedCount: number;
}

export const TAG_KINDS = ["topic", "team"] as const;
/** `team`: an org/group's own memes (e.g. "google"); `topic`: genre such as "oldschool" or "movie". */
export type TagKind = (typeof TAG_KINDS)[number];

export interface Tag {
  slug: string;
  name: string;
  kind: TagKind;
  description: string;
  /** Visible top-level templates carrying the tag (directly or via a variation). */
  templateCount: number;
  /** Posted public memes carrying the tag (directly or via their template). */
  memeCount: number;
}

export interface HotTemplate {
  /** Top-level template; uses of its variations roll up into it. */
  template: Template;
  /** Memes created from it inside the period. */
  uses: number;
  /** Of those uses, how many were posted inside the period. */
  posts: number;
}

export interface UsagePoint {
  /** Bucket start, ISO timestamp. */
  at: string;
  uses: number;
  posts: number;
}

export interface TemplateUsage {
  templateId: string;
  period: Period;
  bucket: "hour" | "day" | "month";
  points: UsagePoint[];
}

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface Meme {
  id: string;
  title: string;
  owner: Pick<User, "id" | "username">;
  /** Every meme is made from a template. */
  templateId: string;
  sourceAsset: Asset;
  outputAsset: Asset;
  /** Empty for multi-panel memes. */
  layers: Layer[];
  /** Set for memes made from a multi-panel template. */
  panels: PanelSet | null;
  visibility: Visibility;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  downvotes: number;
  score: number;
  /** Viewer's vote: -1, 0, 1. */
  myVote: number;
  /** The viewer starred it (saved to their Favorites). */
  favorited: boolean;
  /** Tag slugs placed directly on this meme (its template's tags also match tag searches). */
  tags: string[];
  /** Non-deleted comments, replies included. */
  commentCount: number;
}

export const PERIODS = ["day", "week", "month", "year", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const GALLERY_SORTS = ["best", "new"] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}
