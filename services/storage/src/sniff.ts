import type { AssetKind } from "@memegen/shared";

export interface Sniffed {
  kind: AssetKind;
  mime: string;
  ext: string;
}

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

/** Identify a file from its magic bytes. Returns null for unsupported types. */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return { kind: "image", mime: "image/png", ext: ".png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: ".jpg" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { kind: "image", mime: "image/webp", ext: ".webp" };
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return { kind: "gif", mime: "image/gif", ext: ".gif" };
  const box = ascii(b, 4, 4);
  if (box === "ftyp") {
    const brand = ascii(b, 8, 4);
    return brand === "qt  "
      ? { kind: "video", mime: "video/quicktime", ext: ".mov" }
      : { kind: "video", mime: "video/mp4", ext: ".mp4" };
  }
  if (box === "moov" || box === "mdat" || box === "wide" || box === "free") {
    return { kind: "video", mime: "video/quicktime", ext: ".mov" };
  }
  const tag = ascii(b, 0, 4);
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return { kind: "font", mime: "font/ttf", ext: ".ttf" };
  if (tag === "true") return { kind: "font", mime: "font/ttf", ext: ".ttf" };
  if (tag === "OTTO") return { kind: "font", mime: "font/otf", ext: ".otf" };
  if (tag === "ttcf") return { kind: "font", mime: "font/collection", ext: ".ttc" };
  if (tag === "wOFF") return { kind: "font", mime: "font/woff", ext: ".woff" };
  if (tag === "wOF2") return { kind: "font", mime: "font/woff2", ext: ".woff2" };
  return null;
}
