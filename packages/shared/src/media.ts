import { STICKER_MIME } from "./limits.ts";
import type { AssetKind } from "./types.ts";

export interface SupportedType {
  kind: AssetKind;
  mime: string;
  /** Extension with the dot, used for storage keys and downloads. */
  ext: string;
}

/** Every file type storage accepts (identified by magic bytes); the single list for accept strings and messages. */
export const SUPPORTED_TYPES: readonly SupportedType[] = [
  { kind: "image", mime: "image/png", ext: ".png" },
  { kind: "image", mime: "image/jpeg", ext: ".jpg" },
  { kind: "image", mime: "image/webp", ext: ".webp" },
  { kind: "gif", mime: "image/gif", ext: ".gif" },
  { kind: "video", mime: "video/mp4", ext: ".mp4" },
  { kind: "video", mime: "video/quicktime", ext: ".mov" },
  { kind: "font", mime: "font/ttf", ext: ".ttf" },
  { kind: "font", mime: "font/otf", ext: ".otf" },
  { kind: "font", mime: "font/collection", ext: ".ttc" },
  { kind: "font", mime: "font/woff", ext: ".woff" },
  { kind: "font", mime: "font/woff2", ext: ".woff2" },
];

const MEDIA_TYPES = SUPPORTED_TYPES.filter((t) => t.kind !== "font");
const FONT_TYPES = SUPPORTED_TYPES.filter((t) => t.kind === "font");

/** `<input type=file accept>` values: mime types plus extensions (some browsers report no type for .mov/.ttf). */
export const MEDIA_ACCEPT = [...MEDIA_TYPES.map((t) => t.mime), ...MEDIA_TYPES.map((t) => t.ext)].join(",");
export const FONT_ACCEPT = [...FONT_TYPES.map((t) => t.mime), ...FONT_TYPES.map((t) => t.ext)].join(",");
/** Still images only (multi-panel template packs). */
export const IMAGE_ACCEPT = SUPPORTED_TYPES.filter((t) => t.kind === "image")
  .flatMap((t) => [t.mime, t.ext])
  .join(",");
/** Stickers: PNG only. */
export const STICKER_ACCEPT = SUPPORTED_TYPES.filter((t) => t.mime === STICKER_MIME)
  .flatMap((t) => [t.mime, t.ext])
  .join(",");

export function extensionForMime(mime: string): string | undefined {
  return SUPPORTED_TYPES.find((t) => t.mime === mime)?.ext;
}

/** "png/jpg/webp/gif/mp4/mov"; without a group, media and fonts joined by "or". */
export function supportedTypesLabel(group?: "media" | "font"): string {
  const label = (types: readonly SupportedType[]) => types.map((t) => t.ext.slice(1)).join("/");
  if (group) return label(group === "font" ? FONT_TYPES : MEDIA_TYPES);
  return `${label(MEDIA_TYPES)} or ${label(FONT_TYPES)}`;
}

/** Browsers play GIF frame delays under 20 ms as 100 ms; decode and duration math both follow that. */
export function gifFrameDelayMs(delayMs: number): number {
  return delayMs < 20 ? 100 : delayMs;
}
