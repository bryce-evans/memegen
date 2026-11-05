import assert from "node:assert/strict";
import { test } from "node:test";
import { propagatedCrops } from "./crops.ts";

test("vertical sheet crops preserve the selected column and skip the divider gap", () => {
  assert.deepEqual(propagatedCrops({ x: 390, y: 6, width: 564, height: 350 }, "vertical", 8, { width: 960, height: 720 }, 10), [
    { x: 390, y: 6, width: 564, height: 350 },
    { x: 390, y: 364, width: 564, height: 350 },
  ]);
});

test("horizontal propagation includes exact-edge crops but never a trailing partial image", () => {
  const crop = { x: 3, y: 2, width: 10, height: 5 };
  assert.deepEqual(propagatedCrops(crop, "horizontal", 2, { width: 37, height: 9 }, 3), [
    crop, { ...crop, x: 15 }, { ...crop, x: 27 },
  ]);
  assert.deepEqual(propagatedCrops(crop, "horizontal", 2, { width: 36, height: 9 }, 3), [crop, { ...crop, x: 15 }]);
  assert.deepEqual(propagatedCrops(crop, "horizontal", 0, { width: 33, height: 9 }, 3), [crop, { ...crop, x: 13 }, { ...crop, x: 23 }]);
});

test("oversized gaps leave the first crop and capacity overflow cannot silently discard crops", () => {
  const crop = { x: 0, y: 0, width: 10, height: 10 };
  assert.deepEqual(propagatedCrops(crop, "vertical", 100, { width: 10, height: 30 }, 1), [crop]);
  assert.throws(() => propagatedCrops(crop, "vertical", 0, { width: 10, height: 30 }, 2), /3 crops exceed/);
  assert.throws(() => propagatedCrops(crop, "vertical", 0, { width: 10, height: 30 }, 0), /no room/);
});

test("invalid source coordinates and fractional or negative gaps are rejected", () => {
  const crop = { x: 0, y: 0, width: 10, height: 10 };
  for (const invalid of [{ x: -1 }, { y: NaN }, { width: 0 }, { height: 1.5 }, { x: 1 }, { y: 1 }]) {
    assert.throws(() => propagatedCrops({ ...crop, ...invalid }, "vertical", 0, { width: 10, height: 10 }, 10));
  }
  for (const gap of [-1, 0.5, Infinity, NaN]) {
    assert.throws(() => propagatedCrops(crop, "vertical", gap, { width: 10, height: 10 }, 10), /Gap/);
  }
  assert.throws(() => propagatedCrops(crop, "vertical", 0, { width: 0, height: 10 }, 10), /Source/);
});
