import { SUPPORTED_TYPES, type SupportedType } from "@memegen/shared";

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

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

/** Identify a file from its magic bytes. Returns null for unsupported types. */
export function sniff(b: Uint8Array): SupportedType | null {
  if (b.length < 12) return null;
  const mime = sniffMime(b);
  return SUPPORTED_TYPES.find((t) => t.mime === mime) ?? null;
}
