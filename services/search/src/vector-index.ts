import faiss, { type Index } from "faiss-node";

/** FAISS factory descriptor past `exactLimit`: an HNSW graph with 32 links per node over full vectors. */
const APPROXIMATE = "HNSW32";
/** FAISS factory descriptor up to `exactLimit`: brute force. */
const EXACT = "Flat";

/**
 * Vectors up to which search stays exact. Brute force at 512 dimensions takes about 2 ms for 50k vectors, and HNSW
 * misses some true top-20 text matches even on a few hundred templates (text queries sit off the image
 * distribution the graph is built from), so the graph only pays off past this.
 */
export const EXACT_LIMIT = 50_000;

/**
 * Searches ask FAISS for at least this many neighbors. HNSW explores `max(efSearch, k)` candidates (efSearch is 16
 * and faiss-node can't set it), so a larger k is the only recall knob.
 */
const MIN_CANDIDATES = 64;

export interface VectorHit {
  key: string;
  /** Inner product with the query. */
  score: number;
}

interface Slot {
  key: string;
  vector: Float32Array;
}

/**
 * Vectors under string keys in FAISS, updated in place: an exact flat index up to `exactLimit` live vectors, an HNSW
 * graph (approximate, sublinear) past it. Neither deletes by key (HNSW can't delete at all), so removed vectors
 * become tombstones that searches skip; the index is rebuilt from the live vectors once tombstones exceed a quarter
 * of them, which keeps removals amortized O(1) inserts each, and whenever it grows past `exactLimit`.
 *
 * It also keeps the running sum and second-moment matrix of the live vectors, so the mean and spread of every
 * vector's score against a query come out exactly in O(d²), without scoring the library.
 */
export class VectorIndex {
  readonly dimension: number;
  private readonly exactLimit: number;
  private index: Index | null = null;
  /** Whether `index` is the HNSW graph. */
  private approximate = false;
  /** FAISS label → its vector; null once removed. */
  private slots: (Slot | null)[] = [];
  private readonly labels = new Map<string, number>();
  /** Σ v over live vectors. */
  private readonly sum: Float64Array;
  /** Σ v vᵀ over live vectors, upper triangle (row i, columns i..d-1) of a row-major d×d matrix. */
  private readonly outer: Float64Array;

  constructor(dimension: number, exactLimit = EXACT_LIMIT) {
    this.dimension = dimension;
    this.exactLimit = exactLimit;
    this.sum = new Float64Array(dimension);
    this.outer = new Float64Array(dimension * dimension);
  }

  /** Live vectors. */
  get size(): number {
    return this.labels.size;
  }

  /**
   * Adds each vector under its key, replacing any vector already there (the last one wins within `entries`). One
   * call inserts the whole batch, which FAISS parallelizes for HNSW: much faster than one call per vector. Growing
   * past `exactLimit` rebuilds the index as HNSW. The index keeps references to the vectors; don't mutate them.
   */
  add(entries: Iterable<[key: string, vector: Float32Array]>): void {
    const batch = new Map(entries);
    for (const [key, vector] of batch) {
      if (vector.length !== this.dimension) throw new Error(`vector has ${vector.length} dimensions, index has ${this.dimension}`);
      this.delete(key);
    }
    if (!batch.size) return;
    const slots = [...batch].map(([key, vector]) => ({ key, vector }));
    for (const s of slots) {
      this.labels.set(s.key, this.slots.length);
      this.slots.push(s);
      this.accumulate(s.vector, 1);
    }
    if (!this.approximate && this.labels.size > this.exactLimit) this.compact();
    else this.insert(slots);
  }

  delete(key: string): boolean {
    const label = this.labels.get(key);
    if (label === undefined) return false;
    this.accumulate(this.slots[label]!.vector, -1);
    this.slots[label] = null;
    this.labels.delete(key);
    if ((this.slots.length - this.labels.size) * 4 > this.labels.size) this.compact();
    return true;
  }

  /** The `k` best live vectors for `query`, best first: exact up to `exactLimit` vectors, approximate past it. */
  search(query: Float32Array, k: number): VectorHit[] {
    // FAISS aborts the process on a search for 0 neighbors, and rejects k above its vector count.
    if (!this.index || k < 1 || this.labels.size === 0) return [];
    const tombstones = this.slots.length - this.labels.size;
    const fetch = Math.min(this.slots.length, (this.approximate ? Math.max(k, MIN_CANDIDATES) : k) + tombstones);
    const { distances, labels } = this.index.search(Array.from(query), fetch);
    const hits: VectorHit[] = [];
    for (let i = 0; i < labels.length && hits.length < k; i++) {
      const slot = labels[i]! >= 0 ? this.slots[labels[i]!] : null;
      if (slot) hits.push({ key: slot.key, score: distances[i]! });
    }
    return hits;
  }

  /** Mean and (population) standard deviation of `query · v` over every live vector v, exactly. */
  moments(query: Float32Array): { mean: number; sd: number } {
    const n = this.labels.size;
    if (n === 0) return { mean: 0, sd: 0 };
    const d = this.dimension;
    let mean = 0;
    let square = 0;
    for (let i = 0; i < d; i++) {
      const qi = query[i]!;
      mean += qi * this.sum[i]!;
      const row = i * d;
      let cross = 0;
      for (let j = i + 1; j < d; j++) cross += query[j]! * this.outer[row + j]!;
      square += qi * (qi * this.outer[row + i]! + 2 * cross);
    }
    mean /= n;
    return { mean, sd: Math.sqrt(Math.max(0, square / n - mean * mean)) };
  }

  private accumulate(v: Float32Array, sign: 1 | -1): void {
    const d = this.dimension;
    for (let i = 0; i < d; i++) {
      const vi = sign * v[i]!;
      this.sum[i] = this.sum[i]! + vi;
      const row = i * d;
      for (let j = i; j < d; j++) this.outer[row + j] = this.outer[row + j]! + vi * v[j]!;
    }
  }

  /**
   * Rebuilds the index from the live vectors, dropping tombstones, as HNSW past `exactLimit` and flat otherwise.
   * The moments already exclude tombstones.
   */
  private compact(): void {
    const live = this.slots.filter((s): s is Slot => s !== null);
    this.slots = live;
    this.labels.clear();
    live.forEach((s, label) => this.labels.set(s.key, label));
    this.index = null;
    this.approximate = live.length > this.exactLimit;
    if (live.length) this.insert(live);
  }

  /** Appends `slots`' vectors to the index (creating it if needed), so they take the next labels in order. */
  private insert(slots: Slot[]): void {
    const flat = new Float32Array(slots.length * this.dimension);
    slots.forEach((s, i) => flat.set(s.vector, i * this.dimension));
    this.index ??= faiss.Index.fromFactory(this.dimension, this.approximate ? APPROXIMATE : EXACT, faiss.MetricType.METRIC_INNER_PRODUCT);
    this.index.add(Array.from(flat));
  }
}
