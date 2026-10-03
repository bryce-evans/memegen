import assert from "node:assert/strict";
import { test } from "node:test";
import { addKeyframeAt, clearAnimation, placeAt, removeKeyframe, setWindow } from "./animation.ts";
import { newTextLayer } from "./defaults.ts";
import { textLayerSchema } from "./schema.ts";

const kf = (t: number, x: number, y = 0.5, opacity = 1) => ({ t, x, y, opacity });

test("placeAt clamps anchors so typed or dragged positions stay schema-valid", () => {
  const moved = placeAt(newTextLayer({ x: 0.5, y: 0.5 }), 0, { x: 3, y: -2 });
  assert.equal(moved.x, 1.5);
  assert.equal(moved.y, -0.5);
  assert.equal(textLayerSchema.safeParse(moved).success, true);
});

test("placeAt on an animated layer upserts a keyframe at t from the interpolated state, leaving static fields", () => {
  const layer = newTextLayer({ x: 0.1, keyframes: [kf(0, 0), kf(2, 1, 0.5, 0)] });
  const out = placeAt(layer, 1, { y: 9 });
  assert.equal(out.x, 0.1);
  assert.deepEqual(out.keyframes, [kf(0, 0), kf(1, 0.5, 1.5, 0.5), kf(2, 1, 0.5, 0)]);
});

test("addKeyframeAt on a static layer keyframes its current position", () => {
  const out = addKeyframeAt(newTextLayer({ x: 0.2, y: 0.3, opacity: 0.4 }), 1.5);
  assert.deepEqual(out.keyframes, [kf(1.5, 0.2, 0.3, 0.4)]);
});

test("removing the last keyframe keeps its state as the static position", () => {
  const layer = newTextLayer({ x: 0.5, y: 0.5, opacity: 1, keyframes: [kf(1, 0.9, 0.2, 0.3)] });
  const out = removeKeyframe(layer, 0);
  assert.deepEqual(out.keyframes, []);
  assert.deepEqual([out.x, out.y, out.opacity], [0.9, 0.2, 0.3]);

  const two = newTextLayer({ x: 0.5, keyframes: [kf(0, 0), kf(1, 1)] });
  const rest = removeKeyframe(two, 0);
  assert.deepEqual(rest.keyframes, [kf(1, 1)]);
  assert.equal(rest.x, 0.5);
});

test("clearAnimation drops keyframes and the window, keeping the state at t", () => {
  const layer = newTextLayer({ start: 0.5, end: 3, keyframes: [kf(0, 0), kf(2, 1)] });
  const out = clearAnimation(layer, 1);
  assert.deepEqual([out.keyframes, out.start, out.end, out.x], [[], null, null, 0.5]);
});

test("setWindow clears the opposite edge instead of inverting the window", () => {
  const layer = newTextLayer({ start: 1, end: 2 });
  assert.deepEqual(setWindow(layer, "start", 3), { ...layer, start: 3, end: null });
  assert.deepEqual(setWindow(layer, "end", 0.5), { ...layer, start: null, end: 0.5 });
  assert.deepEqual(setWindow(layer, "start", 2), { ...layer, start: 2, end: 2 });
  assert.deepEqual(setWindow(layer, "end", null), { ...layer, end: null });
});
