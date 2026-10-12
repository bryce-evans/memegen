import { decodeMedia, type DecodedMedia } from "@memegen/render";
import {
  STICKER_MIME,
  extensionForMime,
  limitViolations,
  stickerViolations,
  supportedTypeForFile,
  supportedTypesLabel,
  TEMPLATE_NAME_MAX_LENGTH,
  type UploadLimits,
} from "@memegen/shared";
import { ApiError } from "./api.ts";

/**
 * Decode a local file and run the same limit checks the storage service applies, before uploading.
 * Violations throw an `ApiError` shaped like the service's 413/422 response.
 */
export async function precheckMedia(file: File, limits: UploadLimits): Promise<DecodedMedia> {
  const kind = supportedTypeForFile(file.name, file.type)?.kind;
  if (!kind || kind === "font") throw new Error(`unsupported file type ${file.type || file.name}; use ${supportedTypesLabel("media")}`);
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

/**
 * `precheckMedia` for a still image (image layers, pack images): other types are refused, before decoding, with the
 * accepted image types. Returns the image's pixel size.
 */
export async function precheckStillImage(file: File, limits: UploadLimits): Promise<{ width: number; height: number }> {
  if (supportedTypeForFile(file.name, file.type)?.kind !== "image") {
    throw new Error(`${file.name || file.type}: only still images (${supportedTypesLabel("image")}) can be used here`);
  }
  const media = await precheckMedia(file, limits);
  const { width, height } = media;
  media.dispose();
  return { width, height };
}

/**
 * The checks `POST /api/stickers` applies (PNG, ≤ `STICKER_MAX_DIMENSION` each edge) plus the image caps, before
 * uploading. Violations throw an `ApiError` shaped like the API's 422.
 */
export async function precheckSticker(file: File, limits: UploadLimits): Promise<void> {
  const mime = supportedTypeForFile(file.name, file.type)?.mime ?? file.type;
  // Type first, so a JPEG or GIF is refused without decoding it.
  if (mime !== STICKER_MIME) throw new ApiError(422, "file can't be a sticker", stickerViolations({ mime, width: 0, height: 0 }));
  const media = await precheckMedia(file, limits);
  const violations = stickerViolations({ mime, width: media.width, height: media.height });
  media.dispose();
  if (violations.length) throw new ApiError(422, "file can't be a sticker", violations);
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

/** A display name from an upload's filename, capped like a template name: "distracted-boyfriend_v2.jpg" → "distracted boyfriend v2". */
export function nameFromFile(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, TEMPLATE_NAME_MAX_LENGTH);
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
