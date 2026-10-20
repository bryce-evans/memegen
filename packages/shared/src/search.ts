import { z } from "zod";
import type { Template } from "./types.ts";

/**
 * Contracts of the optional search sidecar (`services/search`): CLIP embeddings of every template image in a FAISS
 * index. Only the API calls it; the web app sees its results through `GET /api/templates?q=` and
 * `GET /api/templates/duplicates`.
 */

/** Sidecar `POST /search`: templates whose image matches a natural-language query, best first. */
export const searchTextSchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(200).default(48),
});

/** Sidecar `POST /similar`: templates whose image looks like an uploaded asset's (near-duplicates), most alike first. */
export const searchSimilarSchema = z.object({
  assetId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(12),
});

export interface SearchHit {
  /** Any template, variations included; the API applies visibility and rolls variations up. */
  templateId: string;
  /** `/search`: how far the match stands out from the library (z-score). `/similar`: cosine similarity, 0–1. */
  score: number;
}

export interface SearchHits {
  hits: SearchHit[];
}

/** `GET /api/templates/duplicates?assetId=`: templates that already use this image (or one that looks like it). */
export const templateDuplicatesQuerySchema = z.object({ assetId: z.uuid() });

export interface TemplateDuplicate {
  template: Template;
  /** Same bytes (sha256) as the asset. */
  exact: boolean;
  /** Image similarity (cosine, 0–1) from the search sidecar; null when it didn't flag this one (or search is off). */
  similarity: number | null;
}
