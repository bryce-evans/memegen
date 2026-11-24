import assert from "node:assert/strict";
import { test } from "node:test";
import { addKeyframeAt, clearAnimation, layerStateAt, placeAt, removeKeyframe, resizeImage, rotateTo, setWindow } from "./animation.ts";
import { newImageLayer, newTextLayer } from "./defaults.ts";
import { IMAGE_WIDTH_MAX, IMAGE_WIDTH_MIN } from "./limits.ts";
import { ANCHOR_Y_MIN } from "./section.ts";
import { imageLayerSchema, layersSchema, textLayerSchema } from "./schema.ts";

const kf = (t: number, x: number, y = 0.5, opacity = 1) => ({ t, x, y, opacity });

test("placeAt clamps anchors so typed or dragged positions stay schema-valid", () => {
  const moved = placeAt(newTextLayer({ x: 0.5, y: 0.5 }), 0, { x: 3, y: -2 });
  assert.equal(moved.x, 1.5);
  assert.equal(moved.y, -0.5);
  assert.equal(textLayerSchema.safeParse(moved).success, true);
});

test("placeAt lets a layer on the media reach the top of a top-section band, within the schema", () => {
  // Band 1.5 media heights tall: the anchor may go to -0.5 - 1.5 = -2, past the old -0.5 floor.
  const moved = placeAt(newTextLayer({ x: 0.5, y: 0.5 }), 0, { y: -5 }, 1.5);
  assert.equal(moved.y, -2);
  assert.equal(textLayerSchema.safeParse(moved).success, true);
  assert.equal(placeAt(moved, 0, { y: -50 }, 100).y, ANCHOR_Y_MIN);
});

test("resizeImage keeps the width within its bounds, so handle drags stay schema-valid", () => {
  const layer = newImageLayer(crypto.randomUUID());
  assert.equal(resizeImage(layer, 0.6).width, 0.6);
  assert.equal(resizeImage(layer, 0).width, IMAGE_WIDTH_MIN);
  const huge = resizeImage(layer, 9);
  assert.equal(huge.width, IMAGE_WIDTH_MAX);
  assert.equal(imageLayerSchema.safeParse(huge).success, true);
});

test("rotateTo wraps any angle into -180..<180, the slider's range", () => {
  const layer = newImageLayer(crypto.randomUUID());
  assert.deepEqual([90, 179, 180, 190, -190, 540, -720].map((a) => rotateTo(layer, a).angle), [90, 179, -180, -170, 170, -180, 0]);
});

test("placeAt on an animated layer upserts a keyframe at t from the interpolated state, leaving static fields", () => {
  const layer = newImageLayer(crypto.randomUUID(), { x: 0.1, keyframes: [kf(0, 0), kf(2, 1, 0.5, 0)] });
  const out = placeAt(layer, 1, { y: 9 });
  assert.equal(out.x, 0.1);
  assert.deepEqual(out.keyframes, [kf(0, 0), kf(1, 0.5, 1.5, 0.5), kf(2, 1, 0.5, 0)]);
});

test("addKeyframeAt on a static layer keyframes its current position", () => {
  const out = addKeyframeAt(newImageLayer(crypto.randomUUID(), { x: 0.2, y: 0.3, opacity: 0.4 }), 1.5);
  assert.deepEqual(out.keyframes, [kf(1.5, 0.2, 0.3, 0.4)]);
});

test("removing the last keyframe keeps its state as the static position", () => {
  const layer = newImageLayer(crypto.randomUUID(), { x: 0.5, y: 0.5, opacity: 1, keyframes: [kf(1, 0.9, 0.2, 0.3)] });
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

test("legacy text fades are opaque at every frame while image fades still interpolate", () => {
  const text = { ...newTextLayer(), opacity: 0.2, keyframes: [kf(1, 0.2, 0.3, 0), kf(3, 0.8, 0.7, 0.4)] };
  const image = newImageLayer(crypto.randomUUID(), { opacity: text.opacity, keyframes: text.keyframes });
  assert.equal(layerStateAt({ ...text, keyframes: [] }, 0).opacity, 1);
  assert.equal(layerStateAt({ ...image, keyframes: [] }, 0).opacity, 0.2);
  for (const [t, x, y, opacity] of [[0, 0.2, 0.3, 0], [2, 0.5, 0.5, 0.2], [4, 0.8, 0.7, 0.4]]) {
    assert.deepEqual(layerStateAt(text, t!), { x, y, opacity: 1, visible: true });
    assert.deepEqual(layerStateAt(image, t!), { x, y, opacity, visible: true });
  }
});

test("loading and saving layers removes text fades without changing image opacity or animation", () => {
  const text = { ...newTextLayer(), opacity: 0.2, keyframes: [kf(1, 0.2, 0.3, 0), kf(3, 0.8, 0.7, 0.4)] };
  const image = newImageLayer(crypto.randomUUID(), { opacity: text.opacity, keyframes: text.keyframes });
  const [savedText, savedImage] = layersSchema.parse([text, image]);
  assert.deepEqual(savedText, { ...text, opacity: 1, keyframes: [kf(1, 0.2, 0.3), kf(3, 0.8, 0.7)] });
  assert.deepEqual(savedImage, image);
});

test("text creation and animation edits cannot introduce opacity", () => {
  const created = newTextLayer({ opacity: 0.2, keyframes: [kf(1, 0.2, 0.3, 0)] });
  assert.equal(created.opacity, 1);
  assert.deepEqual(created.keyframes, [kf(1, 0.2, 0.3)]);
  const legacy = { ...created, opacity: 0.2, keyframes: [kf(1, 0.2, 0.3, 0)] };
  assert.equal(placeAt({ ...legacy, keyframes: [] }, 0, { opacity: 0 }).opacity, 1);
  assert.deepEqual(placeAt(legacy, 1, { opacity: 0 }).keyframes, [kf(1, 0.2, 0.3)]);
  assert.deepEqual(addKeyframeAt(legacy, 1).keyframes, [kf(1, 0.2, 0.3)]);
  assert.equal(removeKeyframe(legacy, 0).opacity, 1);
  assert.equal(clearAnimation(legacy, 1).opacity, 1);
});
