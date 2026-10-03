import type { MediaKind } from "./types.ts";

export interface MediaLimit {
  /** Longest edge in pixels. */
  maxDimension: number;
  /** Max decoded frames; only for animated kinds. */
  maxFrames?: number;
}

export interface UploadLimits {
  maxBytes: number;
  image: MediaLimit;
  gif: Required<MediaLimit>;
  video: Required<MediaLimit>;
}

export const DEFAULT_LIMITS: UploadLimits = {
  maxBytes: 20 * 1024 * 1024,
  image: { maxDimension: 4096 },
  gif: { maxDimension: 1024, maxFrames: 500 },
  video: { maxDimension: 1920, maxFrames: 1800 },
};

/** Characters in one text layer. */
export const TEXT_MAX_LENGTH = 2000;
/** Characters in one comment. */
export const COMMENT_MAX_LENGTH = 2000;
/** Tags on one meme or template. */
export const MAX_TAGS = 20;

/**
 * Still memes export at least this long on their longest edge (never past the image cap): small templates are
 * upscaled so the text is rasterized sharply. GIFs and videos keep their native size (frame/size caps).
 */
export const STILL_EXPORT_MIN_EDGE = 1200;

/** Pixel size for a still export of a `width`×`height` source under `limits`. */
export function stillExportSize(width: number, height: number, limits: UploadLimits): { width: number; height: number } {
  const longest = Math.max(width, height);
  const target = Math.min(Math.max(longest, STILL_EXPORT_MIN_EDGE), limits.image.maxDimension);
  const scale = Math.max(1, target / longest);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface MediaFacts {
  kind: MediaKind;
  width: number;
  height: number;
  frameCount: number | null;
}

/** Human-readable violations; empty when the file fits. */
export function limitViolations(sizeBytes: number, media: MediaFacts | null, limits: UploadLimits): string[] {
  const errors: string[] = [];
  if (sizeBytes > limits.maxBytes) {
    errors.push(`file is ${formatMB(sizeBytes)}, max is ${formatMB(limits.maxBytes)}`);
  }
  if (!media) return errors;
  const limit: MediaLimit = limits[media.kind];
  const longest = Math.max(media.width, media.height);
  if (longest > limit.maxDimension) {
    errors.push(`${media.kind} is ${media.width}x${media.height}, longest edge max is ${limit.maxDimension}px`);
  }
  if (limit.maxFrames !== undefined && media.frameCount !== null && media.frameCount > limit.maxFrames) {
    errors.push(`${media.kind} has ${media.frameCount} frames, max is ${limit.maxFrames}`);
  }
  return errors;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
