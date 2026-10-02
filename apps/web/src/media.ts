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
