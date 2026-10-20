import { config, searchConfig } from "@memegen/server-kit";
import type { SearchHit, SearchHits } from "@memegen/shared";

/**
 * The search sidecar as the API sees it. Search is an extra: when the sidecar is off, slow, or failing, these resolve
 * to no hits and template search falls back to names and tags.
 */
export interface TemplateSearch {
  /** Templates whose image matches a natural-language query, best first. */
  text(q: string, limit: number): Promise<SearchHit[]>;
  /** Templates whose image looks like the asset's, most alike first. */
  similar(assetId: string, limit: number): Promise<SearchHit[]>;
}

/** Text search runs on every keystroke-debounced query, so it gives up quickly. */
const TEXT_TIMEOUT_MS = 3_000;
/** Duplicate checks run once per upload and may wait for a first-time image embedding. */
const SIMILAR_TIMEOUT_MS = 20_000;

/** The sidecar at `url`, or null when search is off. */
export function templateSearch(url: string = searchConfig.url): TemplateSearch | null {
  if (!url) return null;
  async function call(path: string, body: unknown, timeoutMs: number): Promise<SearchHit[]> {
    try {
      const res = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-token": config.internalToken },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return ((await res.json()) as SearchHits).hits;
    } catch (err) {
      console.error(`search ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  return {
    text: (q, limit) => call("/search", { q, limit }, TEXT_TIMEOUT_MS),
    similar: (assetId, limit) => call("/similar", { assetId, limit }, SIMILAR_TIMEOUT_MS),
  };
}
