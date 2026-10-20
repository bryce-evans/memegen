import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SearchHit } from "@memegen/shared";
import { HttpError, type Sql } from "@memegen/server-kit";
import type { Clip } from "./clip.ts";
import { VectorIndex } from "./vector-index.ts";

/**
 * Text search scores each template by how far its match stands out from the rest of the library (a z-score of its
 * debiased similarity), since raw CLIP text–image similarity barely separates a hit from noise. A query returns
 * nothing unless its best match reaches `TEXT_MIN_TOP_Z`, then every match from `TEXT_MIN_Z` up. Starting points:
 * tune against the real library.
 */
export const TEXT_MIN_TOP_Z = 2.5;
export const TEXT_MIN_Z = 2.0;

/**
 * Image–image cosine similarity from which an upload counts as a duplicate. Re-encodes, resizes, and light crops of
 * the same picture score ≥ 0.93; different templates of one subject (doge vs. cheems) about 0.90.
 */
export const DUPLICATE_MIN_SIMILARITY = 0.92;

/** Kinds CLIP can read (a GIF by its first frame). Videos are found by name and tags only. */
const INDEXED_KINDS = ["image", "gif"];

const RETRY_FAILED_MS = 60_000;

/** Reads an asset's bytes (storage's `GET /assets/:id/content`). */
export type FetchAsset = (assetId: string) => Promise<Uint8Array>;

interface CacheFile {
  model: string;
  /** sha256 of the asset bytes → base64 of the Float32 embedding. */
  vectors: Record<string, string>;
}

/**
 * Every template image's CLIP embedding (keyed by template id) in a `VectorIndex`: approximate inner-product search
 * over unit vectors, so cosine similarity. Postgres is the source of truth: each request first syncs the index with
 * the `templates` table, embedding only images it hasn't seen and adding or removing only what changed. Embeddings
 * are keyed by content hash and cached on disk, so restarts and re-uploads of the same bytes cost nothing.
 */
export class TemplateCatalog {
  private readonly sql: Sql;
  private readonly clip: Promise<Clip>;
  private readonly fetchAsset: FetchAsset;
  private readonly cachePath: string;
  private vectors: Map<string, Float32Array> | null = null;
  /** When each image last failed to embed (bad bytes, storage down); retried after `RETRY_FAILED_MS`. */
  private readonly failed = new Map<string, number>();
  private index: VectorIndex | null = null;
  /** Template id → sha256 of the image it's indexed under. */
  private readonly indexed = new Map<string, string>();
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;

  constructor(sql: Sql, clip: Promise<Clip>, fetchAsset: FetchAsset, dataDir: string, model: string) {
    this.sql = sql;
    this.clip = clip;
    this.fetchAsset = fetchAsset;
    this.cachePath = join(dataDir, `embeddings-${model.replace(/[^A-Za-z0-9.-]+/g, "_")}.json`);
  }

  get size(): number {
    return this.indexed.size;
  }

  /**
   * Brings the index up to date with the database. Concurrent callers share one run; a call made while a run is in
   * progress waits for a fresh one, so it always sees writes committed before it was made.
   */
  sync(): Promise<void> {
    if (this.queued) return this.queued;
    if (!this.running) {
      this.running = this.runSync().finally(() => (this.running = null));
      return this.running;
    }
    this.queued = this.running
      .catch(() => {})
      .then(() => {
        this.queued = null;
        return this.sync();
      });
    return this.queued;
  }

  /**
   * Templates whose image matches `query`, best first; `score` is the z-score of its debiased similarity against the
   * whole library (exact, from the index's moments), so the cutoffs don't depend on which neighbors HNSW returns.
   */
  async searchText(query: string, limit: number): Promise<SearchHit[]> {
    await this.sync();
    const index = this.index;
    if (!index || index.size < 2) return [];
    const direction = await (await this.clip).embedQuery(query);
    const { mean, sd } = index.moments(direction);
    // Identical images leave a rounding-error spread, not exactly 0.
    if (sd < 1e-9) return [];
    const hits = index.search(direction, limit).map((h) => ({ templateId: h.key, score: (h.score - mean) / sd }));
    if (!hits.length || hits[0]!.score < TEXT_MIN_TOP_Z) return [];
    return hits.filter((h) => h.score >= TEXT_MIN_Z).map((h) => ({ templateId: h.templateId, score: round(h.score) }));
  }

  /** Templates whose image looks like asset `assetId`'s (near-duplicates), most alike first; `score` is cosine. */
  async similar(assetId: string, limit: number): Promise<SearchHit[]> {
    const [asset] = await this.sql<{ kind: string; sha256: string }[]>`select kind, sha256 from assets where id = ${assetId}`;
    if (!asset) throw new HttpError(404, "asset not found");
    if (!INDEXED_KINDS.includes(asset.kind)) return [];
    await this.sync();
    if (!this.index) return [];
    const vector = this.vectors!.get(asset.sha256) ?? (await (await this.clip).embedImage(await this.fetchAsset(assetId)));
    return this.index
      .search(vector, limit)
      .map((h) => ({ templateId: h.key, score: round(h.score) }))
      .filter((h) => h.score >= DUPLICATE_MIN_SIMILARITY);
  }

  private async runSync(): Promise<void> {
    const clip = await this.clip;
    const vectors = (this.vectors ??= await this.loadCache(clip.model));
    const rows = await this.sql<{ id: string; asset_id: string; sha256: string }[]>`
      select t.id, t.asset_id, a.sha256 from templates t join assets a on a.id = t.asset_id
      where a.kind in ${this.sql(INDEXED_KINDS)}
      order by t.id`;
    let embedded = 0;
    for (const row of rows) {
      if (vectors.has(row.sha256) || Date.now() - (this.failed.get(row.sha256) ?? -Infinity) < RETRY_FAILED_MS) continue;
      try {
        vectors.set(row.sha256, await clip.embedImage(await this.fetchAsset(row.asset_id)));
        embedded++;
      } catch (err) {
        this.failed.set(row.sha256, Date.now());
        console.error(`can't index template ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (embedded) await this.saveCache(clip.model, vectors);

    const index = (this.index ??= new VectorIndex(clip.dimension));
    const wanted = new Map(rows.filter((r) => vectors.has(r.sha256)).map((r) => [r.id, r.sha256]));
    let removed = 0;
    for (const [id, sha] of this.indexed) {
      if (wanted.get(id) === sha) continue;
      index.delete(id);
      this.indexed.delete(id);
      removed++;
    }
    const added: [string, Float32Array][] = [];
    for (const [id, sha] of wanted) {
      if (this.indexed.has(id)) continue;
      added.push([id, vectors.get(sha)!]);
      this.indexed.set(id, sha);
    }
    index.add(added);
    if (added.length || removed) console.log(`indexed ${added.length}, removed ${removed} template(s); ${index.size} searchable`);
  }

  private async loadCache(model: string): Promise<Map<string, Float32Array>> {
    const vectors = new Map<string, Float32Array>();
    let file: CacheFile;
    try {
      file = JSON.parse(await readFile(this.cachePath, "utf8")) as CacheFile;
    } catch {
      return vectors;
    }
    if (file.model !== model) return vectors;
    for (const [sha, b64] of Object.entries(file.vectors)) {
      const bytes = Buffer.from(b64, "base64");
      vectors.set(sha, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    }
    return vectors;
  }

  /** Written whole, then renamed into place, so a crash never leaves a torn cache. */
  private async saveCache(model: string, vectors: Map<string, Float32Array>): Promise<void> {
    const file: CacheFile = { model, vectors: {} };
    for (const [sha, v] of vectors) file.vectors[sha] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
    const tmp = `${this.cachePath}.tmp`;
    await mkdir(join(this.cachePath, ".."), { recursive: true });
    await writeFile(tmp, JSON.stringify(file));
    await rename(tmp, this.cachePath);
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
