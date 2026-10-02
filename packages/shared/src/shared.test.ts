import assert from "node:assert/strict";
import { test } from "node:test";
import { interpolate, layerStateAt, upsertKeyframe } from "./animation.ts";
import { newTextLayer } from "./defaults.ts";
import { DEFAULT_LIMITS, limitViolations } from "./limits.ts";
import { layoutText, mockCase, MIN_FONT_PX, type TextContext } from "./text.ts";
import { textLayerSchema } from "./schema.ts";

const kf = (t: number, x: number, opacity = 1) => ({ t, x, y: 0.5, opacity });

test("interpolate clamps before the first and after the last keyframe", () => {
  const frames = [kf(1, 0.2), kf(3, 0.6)];
  assert.equal(interpolate(frames, 0, "x"), 0.2);
  assert.equal(interpolate(frames, 5, "x"), 0.6);
  assert.equal(interpolate(frames, 3, "x"), 0.6);
});

test("interpolate is linear between keyframes", () => {
  const frames = [kf(0, 0), kf(2, 1, 0), kf(4, 0.5, 1)];
  assert.equal(interpolate(frames, 1, "x"), 0.5);
  assert.equal(interpolate(frames, 1, "opacity"), 0.5);
  assert.equal(interpolate(frames, 3, "x"), 0.75);
});

test("layerStateAt uses static position without keyframes and honors the visibility window inclusively", () => {
  const layer = newTextLayer({ x: 0.3, y: 0.7, start: 1, end: 2 });
  assert.deepEqual(layerStateAt(layer, 1), { x: 0.3, y: 0.7, opacity: 1, visible: true });
  assert.equal(layerStateAt(layer, 2).visible, true);
  assert.equal(layerStateAt(layer, 0.99).visible, false);
  assert.equal(layerStateAt(layer, 2.01).visible, false);
});

test("upsertKeyframe replaces a keyframe at the same time and keeps order", () => {
  const out = upsertKeyframe([kf(0, 0), kf(2, 1)], kf(1, 0.5));
  assert.deepEqual(out.map((k) => k.t), [0, 1, 2]);
  const replaced = upsertKeyframe(out, kf(1.00001, 0.9));
  assert.deepEqual(replaced.map((k) => k.x), [0, 0.9, 1]);
});

test("limitViolations: at the cap passes, one over fails, per kind", () => {
  const L = DEFAULT_LIMITS;
  assert.deepEqual(limitViolations(L.maxBytes, null, L), []);
  assert.equal(limitViolations(L.maxBytes + 1, null, L).length, 1);
  const gif = { kind: "gif" as const, width: L.gif.maxDimension, height: 10, frameCount: L.gif.maxFrames };
  assert.deepEqual(limitViolations(1, gif, L), []);
  assert.equal(limitViolations(1, { ...gif, frameCount: L.gif.maxFrames + 1 }, L).length, 1);
  assert.equal(limitViolations(1, { ...gif, height: L.gif.maxDimension + 1 }, L).length, 1);
  // A 4096px still image is fine, but the same size as a gif is not.
  assert.deepEqual(limitViolations(1, { kind: "image", width: 4096, height: 4096, frameCount: 1 }, L), []);
  assert.equal(limitViolations(1, { kind: "gif", width: 4096, height: 4096, frameCount: 1 }, L).length, 1);
});

test("mockCase alternates letters only", () => {
  assert.equal(mockCase("hello, world"), "hElLo, WoRlD");
});

/** Monospace fake: every character is 0.5em wide. */
function fakeCtx(): TextContext {
  let px = 10;
  const ctx = {
    get font() {
      return `${px}px x`;
    },
    set font(v: string) {
      px = parseFloat(v);
    },
    measureText: (s: string) => ({ width: s.length * px * 0.5 }),
  };
  return ctx as unknown as TextContext;
}

test("layoutText wraps at the box width and shrinks until the text fits the box", () => {
  const layer = newTextLayer({ text: "one two three four five six", fontSize: 0.2, maxWidth: 1, maxHeight: 0.2, strokeWidth: 0 });
  const layout = layoutText(fakeCtx(), layer, 200, 200);
  assert.ok(layout.width <= 200 && layout.height <= 40, `box ${layout.width}x${layout.height}`);
  assert.ok(layout.fontPx < 40, "shrunk below the max size");
  assert.equal(layout.overflow, false);
  assert.equal(layout.lines.join(" "), "ONE TWO THREE FOUR FIVE SIX");
});

test("layoutText reports overflow when even the minimum size does not fit", () => {
  const layer = newTextLayer({ text: "x".repeat(500), maxWidth: 0.1, maxHeight: 0.01, strokeWidth: 0 });
  const layout = layoutText(fakeCtx(), layer, 100, 100);
  assert.equal(layout.fontPx, MIN_FONT_PX);
  assert.equal(layout.overflow, true);
});

test("textLayerSchema sorts keyframes and rejects inverted windows", () => {
  const layer = newTextLayer({ keyframes: [kf(2, 0), kf(1, 0)] });
  assert.deepEqual(textLayerSchema.parse(layer).keyframes.map((k) => k.t), [1, 2]);
  assert.equal(textLayerSchema.safeParse({ ...layer, start: 3, end: 1 }).success, false);
});
