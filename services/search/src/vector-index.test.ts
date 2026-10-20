import assert from "node:assert/strict";
import { test } from "node:test";
import { VectorIndex } from "./vector-index.ts";

const D = 16;

/** Deterministic unit vectors (mulberry32), so HNSW's graph and every result are the same on every run. */
function vectors(count: number, seed: number): Float32Array[] {
  let s = seed;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  return Array.from({ length: count }, () => {
    const v = Float32Array.from({ length: D }, next);
    const length = Math.hypot(...v);
    return v.map((x) => x / length);
  });
}

function bruteMoments(live: Float32Array[], q: Float32Array): { mean: number; sd: number } {
  const scores = live.map((v) => dot(v, q));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { mean, sd: Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length) };
}

function dot(a: Float32Array, b: Float32Array): number {
  return a.reduce((sum, x, i) => sum + x * b[i]!, 0);
}

// exactLimit: always exact; always HNSW; flat for the first batch, HNSW after the second, flat again once removals
// shrink it back under the limit.
for (const [mode, exactLimit] of [
  ["exact", Infinity],
  ["approximate", 0],
  ["crossing the limit", 250],
] as const) {
  test(`${mode}: removed and replaced vectors never surface, across tombstones and rebuilds`, () => {
    const index = new VectorIndex(D, exactLimit);
    const data = vectors(300, 1);
    index.add(data.slice(0, 200).map((v, i) => [`k${i}`, v]));
    index.add(data.slice(200).map((v, i) => [`k${i + 200}`, v]));
    // The first removals stay tombstones; later ones pass the compaction threshold.
    const removed = new Set<string>();
    for (let i = 0; i < 300; i += 3) {
      assert.equal(index.delete(`k${i}`), true);
      removed.add(`k${i}`);
      for (const hit of index.search(data[i]!, 10)) assert.ok(!removed.has(hit.key), `${hit.key} was removed`);
    }
    assert.equal(index.delete("k0"), false);
    // Replacing moves a key to its new vector; its old one is gone.
    const fresh = vectors(1, 2)[0]!;
    index.add([["k1", fresh]]);
    assert.equal(index.size, 200);
    assert.equal(index.search(fresh, 1)[0]!.key, "k1");
    assert.ok(index.search(data[1]!, 10).every((h) => h.score < 0.999), "k1's old vector is still indexed");

    const all = index.search(fresh, index.size);
    assert.equal(new Set(all.map((h) => h.key)).size, all.length);
    assert.ok(all.every((h) => !removed.has(h.key)));
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1]!.score >= all[i]!.score);
  });
}

test("under the limit, search is exact: the brute-force top k, in order, past tombstones", () => {
  const index = new VectorIndex(D);
  const data = vectors(200, 7);
  index.add(data.map((v, i) => [`k${i}`, v]));
  // 30 of 200 removed stays under the compaction threshold, so tombstones sit among the candidates.
  const live = new Map(data.map((v, i) => [`k${i}`, v]));
  for (const v of [...live.keys()].slice(0, 30)) {
    index.delete(v);
    live.delete(v);
  }
  for (const q of vectors(10, 8)) {
    const want = [...live]
      .map(([key, v]) => ({ key, score: dot(v, q) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((h) => h.key);
    assert.deepEqual(index.search(q, 20).map((h) => h.key), want);
  }
});

test("moments match a brute-force pass over the live vectors after adds, removes, and replacements", () => {
  const index = new VectorIndex(D);
  const data = vectors(120, 3);
  const live = new Map<string, Float32Array>();
  index.add(data.map((v, i) => [`k${i}`, v]));
  data.forEach((v, i) => live.set(`k${i}`, v));
  for (let i = 0; i < 120; i += 2) {
    index.delete(`k${i}`);
    live.delete(`k${i}`);
  }
  // A key twice in one batch counts once, under its last vector.
  const [stale, replacement] = vectors(2, 4);
  index.add([
    ["k1", stale!],
    ["k1", replacement!],
  ]);
  live.set("k1", replacement!);
  assert.equal(index.size, live.size);

  // Not unit length, like a debiased text query.
  const q = vectors(1, 5)[0]!.map((x) => x * 0.7 + 0.05);
  const got = index.moments(q);
  const want = bruteMoments([...live.values()], q);
  assert.ok(Math.abs(got.mean - want.mean) < 1e-9, `mean ${got.mean} vs ${want.mean}`);
  assert.ok(Math.abs(got.sd - want.sd) < 1e-9, `sd ${got.sd} vs ${want.sd}`);
});

test("an emptied index searches to nothing and refills", () => {
  const index = new VectorIndex(D);
  const [a, b] = vectors(2, 6);
  index.add([["a", a!]]);
  index.delete("a");
  assert.equal(index.size, 0);
  assert.deepEqual(index.search(a!, 5), []);
  assert.deepEqual(index.moments(a!), { mean: 0, sd: 0 });
  index.add([["b", b!]]);
  assert.deepEqual(index.search(b!, 5).map((h) => h.key), ["b"]);
});
