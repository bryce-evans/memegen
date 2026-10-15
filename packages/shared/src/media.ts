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
const IMAGE_TYPES = SUPPORTED_TYPES.filter((t) => t.kind === "image");
const FONT_TYPES = SUPPORTED_TYPES.filter((t) => t.kind === "font");

/** `<input type=file accept>` values: mime types plus extensions (some browsers report no type for .mov/.ttf). */
export const MEDIA_ACCEPT = [...MEDIA_TYPES.map((t) => t.mime), ...MEDIA_TYPES.map((t) => t.ext)].join(",");
export const FONT_ACCEPT = [...FONT_TYPES.map((t) => t.mime), ...FONT_TYPES.map((t) => t.ext)].join(",");
/** Still images only (image layers, multi-panel template packs). */
export const IMAGE_ACCEPT = IMAGE_TYPES.flatMap((t) => [t.mime, t.ext]).join(",");
/** Stickers: PNG only. */
export const STICKER_ACCEPT = SUPPORTED_TYPES.filter((t) => t.mime === STICKER_MIME)
  .flatMap((t) => [t.mime, t.ext])
  .join(",");

export function extensionForMime(mime: string): string | undefined {
  return SUPPORTED_TYPES.find((t) => t.mime === mime)?.ext;
}

/** Best client-side guess from a file's browser-reported type or its extension; the server sniffs the real type. */
export function supportedTypeForFile(name: string, mime: string): SupportedType | undefined {
  const lower = name.toLowerCase();
  return SUPPORTED_TYPES.find((t) => t.mime === mime || lower.endsWith(t.ext));
}

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

function sniffMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  const box = ascii(b, 4, 4);
  if (box === "ftyp") return ascii(b, 8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  if (box === "moov" || box === "mdat" || box === "wide" || box === "free") return "video/quicktime";
  const tag = ascii(b, 0, 4);
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || tag === "true") return "font/ttf";
  if (tag === "OTTO") return "font/otf";
  if (tag === "ttcf") return "font/collection";
  if (tag === "wOFF") return "font/woff";
  if (tag === "wOF2") return "font/woff2";
  return null;
}

/** Identify a file from its magic bytes (storage uploads, AI image inputs and outputs). Null for unsupported types. */
export function sniff(b: Uint8Array): SupportedType | null {
  if (b.length < 12) return null;
  const mime = sniffMime(b);
  return SUPPORTED_TYPES.find((t) => t.mime === mime) ?? null;
}

const GROUP_TYPES = { media: MEDIA_TYPES, image: IMAGE_TYPES, font: FONT_TYPES };

/** "png/jpg/webp/gif/mp4/mov" for a group (`image`: stills only); without one, media and fonts joined by "or". */
export function supportedTypesLabel(group?: keyof typeof GROUP_TYPES): string {
  const label = (types: readonly SupportedType[]) => types.map((t) => t.ext.slice(1)).join("/");
  if (group) return label(GROUP_TYPES[group]);
  return `${label(MEDIA_TYPES)} or ${label(FONT_TYPES)}`;
}

/** Browsers play GIF frame delays under 20 ms as 100 ms; decode and duration math both follow that. */
export function gifFrameDelayMs(delayMs: number): number {
  return delayMs < 20 ? 100 : delayMs;
}
