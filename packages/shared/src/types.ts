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

export interface Keyframe {
  /** Seconds from the start of the media. */
  t: number;
  /** Anchor (box center) as a fraction of media width/height. */
  x: number;
  y: number;
  /** 0..1 */
  opacity: number;
}

export type TextAlign = "left" | "center" | "right";
export const TEXT_STYLES = ["upper", "lower", "none", "mock"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export interface TextLayer {
  id: string;
  text: string;
  /** Font asset; null uses the fallback family. */
  fontAssetId: string | null;
  /** Max font size as a fraction of media height; text shrinks to fit the box. */
  fontSize: number;
  color: string;
  strokeColor: string;
  /** Stroke width as a fraction of the font size. */
  strokeWidth: number;
  align: TextAlign;
  /** Text box size as fractions of media width/height; wraps at width, shrinks to fit. */
  maxWidth: number;
  maxHeight: number;
  textStyle: TextStyle;
  /** Clockwise rotation in degrees around the box center. */
  angle: number;
  /** Static anchor/opacity, used when `keyframes` is empty. */
  x: number;
  y: number;
  opacity: number;
  /** Visibility window in seconds; null = unbounded. */
  start: number | null;
  end: number | null;
  /** Sorted by `t`; when non-empty, overrides x/y/opacity with linear interpolation. */
  keyframes: Keyframe[];
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

export interface Template {
  id: string;
  name: string;
  parentId: string | null;
  owner: Pick<User, "id" | "username"> | null;
  asset: Asset;
  defaultLayers: TextLayer[];
  isPublic: boolean;
  createdAt: string;
  /** Only populated on top-level templates. */
  variations: Template[];
  /** All-time memes created from this template (top-level: including its variations). */
  useCount: number;
  /** Tag slugs placed directly on this template. */
  tags: string[];
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

export type Visibility = "public" | "private";

export interface Meme {
  id: string;
  title: string;
  owner: Pick<User, "id" | "username">;
  templateId: string | null;
  sourceAsset: Asset;
  outputAsset: Asset;
  layers: TextLayer[];
  visibility: Visibility;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  downvotes: number;
  score: number;
  /** Viewer's vote: -1, 0, 1. */
  myVote: number;
  /** Tag slugs placed directly on this meme (its template's tags also match tag searches). */
  tags: string[];
}

export const PERIODS = ["day", "week", "month", "year", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const GALLERY_SORTS = ["best", "new"] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}
