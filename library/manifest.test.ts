import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { tagSlug } from "@memegen/shared";
import { manifestLayers, templateManifestSchema, type ManifestTemplate } from "./manifest.ts";

const fonts = { impact: "00000000-0000-4000-8000-000000000001", sans: "00000000-0000-4000-8000-000000000002" };
const entry: ManifestTemplate = {
  slug: "online/abc123", title: "Example", url: "https://i.imgflip.com/abc123.jpg",
  source: "https://imgflip.com/memegenerator/Example", tags: ["reaction"], layout: "impact",
  risk: 1, rating_tags: ["child-friendly"],
  text: [{ text: "As typed", x: 0.5, y: 0.1, maxWidth: 0.9, maxHeight: 0.2 }],
};
const manifest = (templates: ManifestTemplate[]) => ({ version: 1, sources: [{ name: "Imgflip", url: "https://imgflip.com" }], templates });

test("manifest rejects duplicate identifiers, insecure downloads and out-of-frame center boxes", () => {
  assert.equal(templateManifestSchema.safeParse(manifest([entry])).success, true);
  assert.equal(templateManifestSchema.safeParse(manifest([entry, { ...entry, url: "https://i.imgflip.com/other.jpg" }])).success, false);
  assert.equal(templateManifestSchema.safeParse(manifest([entry, { ...entry, slug: "online/other" }])).success, false);
  assert.equal(templateManifestSchema.safeParse(manifest([{ ...entry, url: "http://i.imgflip.com/abc123.jpg" }])).success, false);
  assert.equal(templateManifestSchema.safeParse(manifest([{ ...entry, text: [{ ...entry.text[0]!, x: 0.1 }] }])).success, false);
  assert.equal(templateManifestSchema.safeParse({ ...manifest([entry]), version: 2 }).success, false);
});

test("manifest requires an integer risk and explicit, unique rating reasons", () => {
  for (const risk of [1, 2, 3, 4, 5]) {
    assert.equal(templateManifestSchema.safeParse(manifest([{ ...entry, risk }])).success, true);
  }
  for (const risk of [undefined, 0, 6, 1.5, "3", null]) {
    assert.equal(templateManifestSchema.safeParse({ ...manifest([]), templates: [{ ...entry, risk }] }).success, false);
  }
  for (const rating_tags of [undefined, [], [""], ["sex", "sex"], ["Bad Language"], ["x".repeat(41)], null]) {
    assert.equal(templateManifestSchema.safeParse({ ...manifest([]), templates: [{ ...entry, rating_tags }] }).success, false);
  }
  const rated = { ...entry, risk: 4, rating_tags: ["language", "innuendo"] };
  assert.deepEqual(templateManifestSchema.parse(manifest([rated])).templates[0], rated);
});

test("F-word catalog metadata stays outside the work risk ceiling", async () => {
  const catalog = templateManifestSchema.parse(JSON.parse(await readFile(new URL("./MANIFEST.json", import.meta.url), "utf8")));
  const fword = /fuck|f\*+k|\b(?:wtf|stfu)\b/i;
  const approvedAbbreviations = new Set(["online/8u2b", "online/59qi"]);
  for (const template of catalog.templates) {
    const content = [template.title, ...template.tags, ...template.text.map((box) => box.text)].join(" ");
    if (!fword.test(content)) continue;
    if (approvedAbbreviations.has(template.slug) && !/fuck|f\*+k/i.test(content)) {
      assert.ok(template.rating_tags.includes("language"), `${template.slug}: abbreviated language still needs a reason`);
      continue;
    }
    assert.ok(template.risk >= 4, `${template.slug}: F-word content must be excluded from work settings`);
    assert.ok(template.rating_tags.includes("language"), `${template.slug}: missing language reason`);
  }
});

test("catalog search tags cover every template without normalized duplicates", async () => {
  const catalog = templateManifestSchema.parse(JSON.parse(await readFile(new URL("./MANIFEST.json", import.meta.url), "utf8")));
  for (const template of catalog.templates) {
    const tags = new Set(template.tags.map(tagSlug));
    assert.ok(tags.size >= 4, `${template.slug}: needs at least four distinct searchable tags`);
    assert.equal(tags.size, template.tags.length, `${template.slug}: duplicate normalized search tags`);
  }
});

test("captions preserve source overrides while layout controls native font and casing", () => {
  const [impact] = manifestLayers(entry, fonts);
  assert.equal(impact?.type, "text");
  if (impact?.type !== "text") throw new Error("expected caption");
  assert.equal(impact.fontAssetId, fonts.impact);
  assert.equal(impact.textStyle, "upper");
  assert.equal(impact.y, 0.1);
  const [subtitle] = manifestLayers({ ...entry, layout: "subtitle" }, fonts);
  if (subtitle?.type !== "text") throw new Error("expected subtitle");
  assert.equal(subtitle.fontAssetId, fonts.sans);
  assert.equal(subtitle.textStyle, "none");
  const [custom] = manifestLayers({ ...entry, layout: "subtitle", text: [{ ...entry.text[0]!, font: "impact", color: "#123456", fontSize: 0.04, align: "left", angle: 20, textStyle: "lower" }] }, fonts);
  if (custom?.type !== "text") throw new Error("expected custom caption");
  assert.equal(custom.fontAssetId, fonts.impact);
  assert.equal(custom.color, "#123456");
  assert.equal(custom.fontSize, 0.04);
  assert.equal(custom.align, "left");
  assert.equal(custom.angle, 20);
  assert.equal(custom.textStyle, "lower");
});

test("checkout captions retain fonts and convert fractional GIF windows using the uploaded duration", () => {
  const checkoutFonts = {
    ...fonts,
    thin: "00000000-0000-4000-8000-000000000003",
    comic: "00000000-0000-4000-8000-000000000004",
  };
  const animated: ManifestTemplate = {
    ...entry, slug: "jb/animated", url: "https://example.com/default.gif",
    text: [
      { ...entry.text[0]!, font: "thin", start: 0.1234, end: 0.75, angle: -15, textStyle: "none" },
      { ...entry.text[0]!, font: "comic", start: 0, end: 1 },
      { ...entry.text[0]! },
    ],
  };
  const parsed = templateManifestSchema.parse(manifest([animated])).templates[0]!;
  const layers = manifestLayers(parsed, checkoutFonts, 2.5);
  assert.deepEqual(layers.map((layer) => [layer.start, layer.end]), [[0.309, 1.875], [null, null], [null, null]]);
  const [thin, comic] = layers;
  if (thin?.type !== "text" || comic?.type !== "text") throw new Error("expected checkout captions");
  assert.equal(thin.fontAssetId, checkoutFonts.thin);
  assert.equal(comic.fontAssetId, checkoutFonts.comic);
  assert.equal(thin.angle, -15);
  assert.equal(thin.textStyle, "none");
  assert.deepEqual(manifestLayers(parsed, checkoutFonts).map((layer) => [layer.start, layer.end]), [[null, null], [null, null], [null, null]]);
  assert.throws(() => manifestLayers(parsed, fonts, 2.5), /Missing catalog font: thin/);
  for (const bounds of [{ start: -0.1 }, { end: 1.1 }, { start: 0.8, end: 0.2 }, { start: 0.5, end: 0.5 }]) {
    assert.equal(templateManifestSchema.safeParse(manifest([{ ...animated, text: [{ ...entry.text[0]!, ...bounds }] }])).success, false);
  }
});

test("comment uses one editable top-section band rather than drawing onto the image", () => {
  const comment = { ...entry, layout: "comment" as const, text: [{ text: "A reaction", x: 0.5, y: 0.5, maxWidth: 0.92, maxHeight: 1 }] };
  const [layer] = manifestLayers(comment, fonts);
  if (layer?.type !== "text") throw new Error("expected top section");
  assert.equal(layer.text, "A reaction");
  assert.ok(layer.topSection, "comment caption must occupy the band above the image");
  assert.equal(layer.strokeWidth, 0);
  assert.equal(layer.textStyle, "none");
  assert.equal(templateManifestSchema.safeParse(manifest([{ ...comment, text: [...comment.text, ...comment.text] }])).success, false);
});
