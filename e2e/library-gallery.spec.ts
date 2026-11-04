import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { encodePng } from "@memegen/server-kit/testing";
import { expect, test } from "./test.ts";

const reasons = ["child-friendly", "innuendo", "politics", "language", "gore"];
const templates = reasons.map((reason, index) => ({
  slug: `online/example${index}`, title: `Example ${index + 1}`,
  url: `https://example.com/${index}.jpg`, source: "https://example.com/source",
  tags: ["example"], risk: index + 1, rating_tags: [reason], layout: "impact",
  text: [{ text: "Example caption", x: 0.5, y: 0.1, maxWidth: 0.9, maxHeight: 0.2 }],
}));
const file = (entries: unknown[]) => ({
  name: "ratings.json", mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ version: 1, templates: entries })),
});

test("library gallery filters risk levels and searches rating reasons", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("library/index.html")).href);
  await page.getByTestId("remote-previews").uncheck();
  await page.getByTestId("manifest-file").setInputFiles(file(templates));
  const cards = page.getByTestId("template-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute("data-risk", "1");
  await expect(cards.nth(1)).toHaveAttribute("data-risk", "2");
  await expect(cards.nth(2)).toHaveAttribute("data-risk", "3");
  await page.getByTestId("risk-filter").selectOption("4");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-risk", "4");
  await expect(cards.getByTestId("template-rating-tags")).toContainText("language");
  await page.getByTestId("risk-filter").selectOption("all");
  await expect(cards).toHaveCount(5);
  await page.getByTestId("gallery-search").fill("gore");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-risk", "5");
  await page.getByTestId("risk-filter").selectOption("safe");
  await expect(cards).toHaveCount(0);
});

test("library gallery combines exact tag filters with the existing score, search and layout filters", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("library/index.html")).href);
  await page.getByTestId("remote-previews").uncheck();
  const tagged = [
    { ...templates[1], slug: "online/catinnuendo", tags: ["Cat"], rating_tags: ["innuendo"] },
    { ...templates[2], slug: "online/catfish", tags: ["Catfish"], rating_tags: ["language"] },
    { ...templates[3], slug: "online/catstrong", tags: ["Cat"], rating_tags: ["language"] },
    { ...templates[1], slug: "online/catmild", tags: ["Cat"], rating_tags: ["language"] },
  ];
  await page.getByTestId("manifest-file").setInputFiles(file(tagged));
  await page.getByTestId("rating-tag-filter").selectOption("language");
  await page.getByTestId("template-tag-filter").fill(" CAT ");
  const cards = page.getByTestId("template-card");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("online/catmild");
  await page.getByTestId("risk-filter").selectOption("all");
  await expect(cards).toHaveCount(2);
  await page.getByTestId("risk-filter").selectOption("4");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("online/catstrong");
  await page.getByTestId("gallery-search").fill("missing");
  await expect(cards).toHaveCount(0);
  await page.getByTestId("gallery-search").fill("");
  await page.getByTestId("layout-filter").selectOption("comment");
  await expect(cards).toHaveCount(0);
  await page.getByTestId("layout-filter").selectOption("impact");
  await expect(cards).toHaveCount(1);
  await page.getByTestId("template-tag-filter").fill("catf");
  await expect(cards).toHaveCount(0);
  await page.getByTestId("template-tag-filter").fill("");
  await page.getByTestId("rating-tag-filter").selectOption("");
  await page.getByTestId("risk-filter").selectOption("safe");
  await expect(cards).toHaveCount(3);

  await page.getByTestId("rating-tag-filter").selectOption("language");
  await page.getByTestId("template-tag-filter").fill("cat");
  await page.getByTestId("manifest-file").setInputFiles(file([templates[0]]));
  await expect(page.getByTestId("rating-tag-filter")).toHaveValue("");
  await expect(page.getByTestId("template-tag-filter")).toHaveValue("");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-risk", "1");
});

test("library gallery rejects unrated input instead of treating it as safe", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("library/index.html")).href);
  await page.getByTestId("remote-previews").uncheck();
  await page.getByTestId("manifest-file").setInputFiles(file([{ ...templates[0], risk: undefined }]));
  await expect(page.getByTestId("gallery-status")).toContainText("Could not load");
  await expect(page.getByTestId("template-card")).toHaveCount(0);
  await page.getByTestId("manifest-file").setInputFiles(file([{ ...templates[0], rating_tags: [] }]));
  await expect(page.getByTestId("gallery-status")).toContainText("rating_tags");
  await expect(page.getByTestId("template-card")).toHaveCount(0);
});

test.describe("library placeholder previews", () => {
  const origin = "https://library-preview.test";
  let bundle: string;
  let html: string;
  let font: Buffer;
  const pixels = new Uint8Array(320 * 240 * 3);
  for (let i = 2; i < pixels.length; i += 3) pixels[i] = 255;
  const image = Buffer.from(encodePng(320, 240, pixels));

  test.beforeAll(async () => {
    bundle = execFileSync("bun", ["build", "library/preview.ts", "--target=browser", "--format=esm"], {
      encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
    });
    [html, font] = await Promise.all([
      readFile("library/index.html", "utf8"),
      readFile("e2e/fixtures/TitilliumWeb-Black.ttf"),
    ]);
  });

  async function openPreview(page: Page, entries: unknown[], missingFonts = false) {
    await page.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ contentType: "text/html", body: html });
      if (path === "/MANIFEST.json") return route.fulfill({ contentType: "application/json", body: file(entries).buffer });
      if (path === "/preview.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (path === "/blank.png") return route.fulfill({ contentType: "image/png", body: image });
      if (path.startsWith("/fonts/")) {
        return route.fulfill({ status: missingFonts ? 503 : 200, contentType: "font/ttf", body: missingFonts ? "Download the library fonts" : font });
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto(origin);
    await expect(page.getByTestId("gallery-status")).toContainText("Loaded MANIFEST.json.");
  }

  const caption = {
    ...templates[0], url: `${origin}/blank.png`, title: "Caption placement",
    text: [{ text: "DEFAULT WORDS", x: 0.5, y: 0.2, maxWidth: 0.9, maxHeight: 0.3, fontSize: 0.1, color: "#ff0000" }],
  };

  test("per-image toggles draw the default words in place and restore the original without affecting other cards", async ({ page }) => {
    await openPreview(page, [caption, { ...caption, slug: "online/second", title: "Second image" }]);
    const cards = page.getByTestId("template-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).not.toContainText("DEFAULT WORDS");
    await cards.first().getByTestId("placeholder-toggle").check();
    const canvas = cards.first().getByTestId("placeholder-canvas");
    await expect(canvas).toHaveAttribute("data-ready", "true");
    await expect(canvas).toBeVisible();
    await expect(cards.nth(1).getByTestId("placeholder-toggle")).not.toBeChecked();
    await expect(cards.nth(1).getByTestId("template-image")).toBeVisible();
    const redBounds = await canvas.evaluate((element) => {
      const c = element as HTMLCanvasElement;
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let minY = c.height, maxY = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (data[i]! > 180 && data[i + 1]! < 80 && data[i + 2]! < 80) {
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
      return { min: minY / c.height, max: maxY / c.height };
    });
    expect(redBounds.min).toBeGreaterThan(0.05);
    expect(redBounds.max).toBeLessThan(0.35);
    expect(redBounds.max).toBeGreaterThan(redBounds.min);
    await cards.first().getByTestId("placeholder-toggle").uncheck();
    await expect(cards.first().getByTestId("template-image")).toBeVisible();
    await expect(canvas).not.toBeVisible();
    await page.getByTestId("remote-previews").uncheck();
    await expect(page.getByTestId("placeholder-toggle").first()).toBeDisabled();
  });

  test("rotated labels and comment bands use native composition rather than a caption below the image", async ({ page }) => {
    await openPreview(page, [
      { ...caption, layout: "labels", text: [{ ...caption.text[0], x: 0.5, y: 0.5, angle: 90, font: "thin" }] },
      { ...caption, slug: "online/comment", title: "Comment band", layout: "comment",
        text: [{ text: "A DEFAULT COMMENT", x: 0.5, y: 0.5, maxWidth: 0.92, maxHeight: 1 }] },
    ]);
    const cards = page.getByTestId("template-card");
    await cards.nth(0).getByTestId("placeholder-toggle").check();
    await cards.nth(1).getByTestId("placeholder-toggle").check();
    const rotated = cards.nth(0).getByTestId("placeholder-canvas");
    const comment = cards.nth(1).getByTestId("placeholder-canvas");
    await expect(rotated).toHaveAttribute("data-ready", "true");
    await expect(comment).toHaveAttribute("data-ready", "true");
    const bounds = await rotated.evaluate((element) => {
      const c = element as HTMLCanvasElement;
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let minX = c.width, maxX = -1, minY = c.height, maxY = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (data[i]! > 180 && data[i + 1]! < 80 && data[i + 2]! < 80) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
      return { width: maxX - minX, height: maxY - minY };
    });
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(bounds.width * 2);
    const band = await comment.evaluate((element) => {
      const c = element as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      return { width: c.width, height: c.height, top: [...ctx.getImageData(1, 1, 1, 1).data], bottom: [...ctx.getImageData(1, c.height - 2, 1, 1).data] };
    });
    expect(band.height / band.width).toBeGreaterThan(240 / 320);
    expect(band.top).toEqual([255, 255, 255, 255]);
    expect(band.bottom).toEqual([0, 0, 255, 255]);
    await expect(cards.nth(1)).not.toContainText("A DEFAULT COMMENT");
  });

  test("missing fonts leave the original image available instead of displaying a fallback-font preview", async ({ page }) => {
    await openPreview(page, [caption], true);
    await page.getByTestId("placeholder-toggle").check();
    await expect(page.getByTestId("placeholder-status")).toContainText(/font|download/i);
    await expect(page.getByTestId("template-image")).toBeVisible();
    await expect(page.getByTestId("placeholder-canvas")).not.toBeVisible();
  });
});
