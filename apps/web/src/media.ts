import { decodeMedia, type DecodedMedia } from "@memegen/render";
import { limitViolations, type MediaKind, type UploadLimits } from "@memegen/shared";
import { ApiError } from "./api.ts";

export const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,.mp4,.mov";
export const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";

/** Best guess from the browser-reported type/extension; the server sniffs the real type. */
function mediaKindOf(file: File): MediaKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "image/gif" || name.endsWith(".gif")) return "gif";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/") || name.endsWith(".mp4") || name.endsWith(".mov")) return "video";
  return null;
}

/**
 * Decode a local file and run the same limit checks the storage service applies, before uploading.
 * Violations throw an `ApiError` shaped like the service's 413/422 response.
 */
export async function precheckMedia(file: File, limits: UploadLimits): Promise<DecodedMedia> {
  const kind = mediaKindOf(file);
  if (!kind) throw new Error(`unsupported file type ${file.type || file.name}; use an image, GIF, MP4 or MOV`);
  const sizeViolations = limitViolations(file.size, null, limits);
  if (sizeViolations.length) throw new ApiError(413, "file is over the upload limits", sizeViolations);
  const media = await decodeMedia(file, kind);
  const violations = limitViolations(
    file.size,
    { kind, width: media.width, height: media.height, frameCount: kind === "image" ? null : media.times.length },
    limits,
  );
  if (violations.length) {
    media.dispose();
    throw new ApiError(422, "file is over the upload limits", violations);
  }
  return media;
}

/** Download/upload base name for a meme: its slugified title, or "meme". */
export function fileSlug(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "meme"
  );
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/** File extension (with dot) for a stored asset: from its filename, else its mime type. */
export function assetExtension(asset: { filename: string; mime: string }): string {
  return asset.filename.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? EXTENSION_BY_MIME[asset.mime] ?? "";
}

/** Save a blob through a temporary `<a download>`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke once the browser has had time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
