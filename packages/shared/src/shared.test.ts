import assert from "node:assert/strict";
import { test } from "node:test";
import { interpolate, layerStateAt, upsertKeyframe } from "./animation.ts";
import { newImageLayer, newTextLayer, newTopSectionLayer } from "./defaults.ts";
import { DEFAULT_LIMITS, limitViolations, STILL_EXPORT_MIN_EDGE, stillExportSize } from "./limits.ts";
import { layoutText, mockCase, MIN_FONT_PX, type TextContext } from "./text.ts";
import { layerSchema, layersSchema, sessionSchema } from "./schema.ts";
import { composedHeight, layerArea, layoutTopSection, topSectionPx } from "./section.ts";
import { badgesFor } from "./badges.ts";
import { extensionForMime, FONT_ACCEPT, gifFrameDelayMs, MEDIA_ACCEPT, SUPPORTED_TYPES } from "./media.ts";

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

test("layerSchema sorts keyframes and rejects inverted windows, for text and image layers alike", () => {
  for (const layer of [newTextLayer({ keyframes: [kf(2, 0), kf(1, 0)] }), newImageLayer(crypto.randomUUID(), { keyframes: [kf(2, 0), kf(1, 0)] })]) {
    assert.deepEqual(layerSchema.parse(layer).keyframes.map((k) => k.t), [1, 2]);
    assert.equal(layerSchema.safeParse({ ...layer, start: 3, end: 1 }).success, false);
  }
});

test("layerSchema requires a known type and that type's fields", () => {
  const text = newTextLayer();
  assert.equal(layerSchema.safeParse({ ...text, type: undefined }).success, false);
  assert.equal(layerSchema.safeParse({ ...text, type: "image" }).success, false); // no assetId/width
  assert.equal(layerSchema.safeParse({ ...newImageLayer(crypto.randomUUID()), type: "video" }).success, false);
});

test("badges: only the highest reached tier per stat shows, at exact thresholds", () => {
  const ids = (memeCount: number, highScore: number, hScore: number) =>
    badgesFor({ memeCount, highScore, hScore }).map((b) => b.id);
  assert.deepEqual(ids(2, 9, 1), []);
  assert.deepEqual(ids(3, 10, 2), ["memeCount-bronze", "highScore-bronze", "hScore-bronze"]);
  assert.deepEqual(ids(9, 24, 4), ["memeCount-bronze", "highScore-bronze", "hScore-bronze"]);
  assert.deepEqual(ids(10, 25, 5), ["memeCount-silver", "highScore-silver", "hScore-silver"]);
  assert.deepEqual(ids(50, 100, 20), ["memeCount-platinum", "highScore-platinum", "hScore-platinum"]);
  assert.deepEqual(ids(1000, 249, 30), ["memeCount-diamond", "highScore-platinum", "hScore-diamond"]);
});

test("sessionSchema rejects the reserved system username in any case", () => {
  assert.equal(sessionSchema.safeParse({ username: "MemeGen" }).success, false);
  assert.equal(sessionSchema.safeParse({ username: "memegen2" }).success, true);
});

test("stillExportSize upscales small stills to the minimum edge, keeps larger ones, never passes the cap", () => {
  assert.equal(STILL_EXPORT_MIN_EDGE, 1200);
  assert.deepEqual(stillExportSize(600, 450, DEFAULT_LIMITS), { width: 1200, height: 900 });
  assert.deepEqual(stillExportSize(300, 600, DEFAULT_LIMITS), { width: 600, height: 1200 });
  assert.deepEqual(stillExportSize(2000, 1000, DEFAULT_LIMITS), { width: 2000, height: 1000 });
  const tight = { ...DEFAULT_LIMITS, image: { maxDimension: 800 } };
  assert.deepEqual(stillExportSize(400, 200, tight), { width: 800, height: 400 });
  assert.deepEqual(stillExportSize(800, 600, tight), { width: 800, height: 600 });
});

test("gifFrameDelayMs plays delays under 20 ms as 100 ms and keeps the rest", () => {
  assert.equal(gifFrameDelayMs(0), 100);
  assert.equal(gifFrameDelayMs(19), 100);
  assert.equal(gifFrameDelayMs(20), 20);
  assert.equal(gifFrameDelayMs(70), 70);
});

test("every supported type maps back to its extension and is in exactly one accept list", () => {
  for (const { kind, mime, ext } of SUPPORTED_TYPES) {
    assert.equal(extensionForMime(mime), ext);
    const [own, other] = kind === "font" ? [FONT_ACCEPT, MEDIA_ACCEPT] : [MEDIA_ACCEPT, FONT_ACCEPT];
    assert.ok(own.split(",").includes(mime) && own.split(",").includes(ext), `${mime} accepted`);
    assert.ok(!other.split(",").includes(mime), `${mime} only in its own list`);
  }
  assert.equal(extensionForMime("application/pdf"), undefined);
});

test("top section: the band is its one-line height plus every extra line of text, so the padding stays fixed", () => {
  // fakeCtx is monospace (0.5em); 0.25 of 640 = 160px band, font 0.15 × 160 = 24px, 48 characters per line.
  const section = { ...newTopSectionLayer(), topSection: { height: 0.25 }, text: "one line" };
  const caption = newTextLayer();
  const layers = [section, caption];
  const ctx = fakeCtx();
  assert.equal(topSectionPx(ctx, layers, 640), 160);
  assert.equal(topSectionPx(ctx, layers, 641), 160); // 160.25 → even, for video encoders
  assert.equal(topSectionPx(ctx, [caption], 640), 0);
  assert.equal(composedHeight(ctx, layers, 640, 480), 640);

  // A second line (font 24px, line height 27.6px) adds its height and nothing more: 58px of text instead of 30.
  const twoLines = [{ ...section, text: Array(8).fill("abcdefghi").join(" ") }, caption];
  const { layout, bandPx } = layoutTopSection(ctx, twoLines[0]!, 640);
  assert.deepEqual([layout.lines.length, layout.fontPx, bandPx], [2, 24, 188]);

  // The band's text is placed in the band; everything else in the media below it.
  assert.deepEqual(layerArea(section, 640, 668, 188), { top: 0, width: 640, height: 188 });
  assert.deepEqual(layerArea(caption, 640, 668, 188), { top: 188, width: 640, height: 480 });

  // One top section at most, within its height range.
  assert.equal(layersSchema.safeParse(layers).success, true);
  assert.equal(layersSchema.safeParse([section, { ...section, id: "second" }]).success, false);
  assert.equal(layersSchema.safeParse([{ ...section, topSection: { height: 0.05 } }]).success, false);
});
