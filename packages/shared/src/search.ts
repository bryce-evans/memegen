import { z } from "zod";
import type { Template } from "./types.ts";

/**
 * Contracts of the optional search sidecar (`services/search`): CLIP embeddings of every template image in a FAISS
 * index. Only the API calls it; the web app sees its results through `GET /api/templates?q=` and
 * `GET /api/templates/duplicates`.
 */

/** API-selected eligible templates. Limits count distinct groups (roots for browse, IDs for duplicates). */
export const searchCandidateSchema = z.object({ templateId: z.uuid(), groupId: z.uuid() });
export type SearchCandidate = z.output<typeof searchCandidateSchema>;

/** Sidecar `POST /search`: templates whose image matches a natural-language query, best first. */
export const searchTextSchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(200).default(48),
  candidates: z.array(searchCandidateSchema),
});

/** Sidecar `POST /similar`: templates whose image looks like an uploaded asset's (near-duplicates), most alike first. */
export const searchSimilarSchema = z.object({
  assetId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(12),
  candidates: z.array(searchCandidateSchema),
});

export const searchHitSchema = z.object({
  templateId: z.uuid(),
  /** Text z-score or image cosine similarity. */
  score: z.number().finite(),
});
export type SearchHit = z.output<typeof searchHitSchema>;

export const searchHitsSchema = z.object({ hits: z.array(searchHitSchema) });
export type SearchHits = z.output<typeof searchHitsSchema>;

/** `GET /api/templates/duplicates?assetId=`: templates that already use this image (or one that looks like it). */
export const templateDuplicatesQuerySchema = z.object({ assetId: z.uuid() });

export interface TemplateDuplicate {
  template: Template;
  /** Same bytes (sha256) as the asset. */
  exact: boolean;
  /** Image similarity (cosine, 0–1) from the search sidecar; null when it didn't flag this one (or search is off). */
  similarity: number | null;
}
