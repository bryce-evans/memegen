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

const searchEnabled = process.env.SEARCH_ENABLED === "true";
const searchPort = num("SEARCH_PORT", 4002);

/** The search sidecar (`services/search`) runs only when `SEARCH_ENABLED=true`; the API then reaches it at `SEARCH_URL`. */
export const searchConfig = {
  enabled: searchEnabled,
  port: searchPort,
  /** Where the API finds the sidecar; empty when search is off. */
  url: searchEnabled ? process.env.SEARCH_URL || `http://localhost:${searchPort}` : "",
  /** Where the sidecar reads asset bytes (storage's `GET /assets/:id/content`). */
  storageUrl: process.env.STORAGE_URL || `http://localhost:${config.storagePort}`,
  /** CLIP model (a transformers.js ONNX export on the Hugging Face hub). */
  model: process.env.SEARCH_MODEL || "Xenova/clip-vit-base-patch32",
  /** Downloaded model weights and the embedding cache. */
  dataDir: process.env.SEARCH_DATA_DIR || ".data/search",
};
