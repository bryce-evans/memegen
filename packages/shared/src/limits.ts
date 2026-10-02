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
