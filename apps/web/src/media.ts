import { decodeMedia, type DecodedMedia } from "@memegen/render";
import {
  SUPPORTED_TYPES,
  extensionForMime,
  limitViolations,
  supportedTypesLabel,
  type MediaKind,
  type UploadLimits,
} from "@memegen/shared";
import { ApiError } from "./api.ts";

/** Best guess from the browser-reported type/extension; the server sniffs the real type. */
function mediaKindOf(file: File): MediaKind | null {
  const name = file.name.toLowerCase();
  const type = SUPPORTED_TYPES.find((t) => t.mime === file.type || name.endsWith(t.ext));
  return type && type.kind !== "font" ? type.kind : null;
}

/**
 * Decode a local file and run the same limit checks the storage service applies, before uploading.
 * Violations throw an `ApiError` shaped like the service's 413/422 response.
 */
export async function precheckMedia(file: File, limits: UploadLimits): Promise<DecodedMedia> {
  const kind = mediaKindOf(file);
  if (!kind) throw new Error(`unsupported file type ${file.type || file.name}; use ${supportedTypesLabel("media")}`);
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

/** File extension (with dot) for a stored asset: from its filename, else its mime type. */
export function assetExtension(asset: { filename: string; mime: string }): string {
  return asset.filename.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? extensionForMime(asset.mime) ?? "";
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
