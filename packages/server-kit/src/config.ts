import { DEFAULT_LIMITS, type UploadLimits } from "@memegen/shared";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got ${raw}`);
  return value;
}

export function uploadLimitsFromEnv(): UploadLimits {
  const d = DEFAULT_LIMITS;
  return {
    maxBytes: num("MAX_UPLOAD_BYTES", d.maxBytes),
    image: { maxDimension: num("MAX_IMAGE_DIMENSION", d.image.maxDimension) },
    gif: { maxDimension: num("MAX_GIF_DIMENSION", d.gif.maxDimension), maxFrames: num("MAX_GIF_FRAMES", d.gif.maxFrames) },
    video: {
      maxDimension: num("MAX_VIDEO_DIMENSION", d.video.maxDimension),
      maxFrames: num("MAX_VIDEO_FRAMES", d.video.maxFrames),
    },
  };
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost:5432/memegen",
  apiPort: num("API_PORT", 4000),
  storagePort: num("STORAGE_PORT", 4001),
  internalToken: process.env.INTERNAL_TOKEN ?? "",
};
