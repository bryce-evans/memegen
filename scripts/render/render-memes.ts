/**
 * Renders seeded memes with the client renderer (`@memegen/render`, the editor's export path) in headless Chromium
 * (Playwright's, see README "Tests"), fully offline: the page and every asset it fetches are served straight from
 * the asset store. Shared by the sample (`scripts/sample`) and starter (`scripts/starter`) datasets.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { Asset, MediaKind, TextLayer } from "@memegen/shared";
import { findAssetRow, type Sql } from "@memegen/server-kit";
import type { AssetStore } from "@memegen/storage";
import { fileSlug } from "../lib.ts";
import type { RenderRequest, RenderResponse } from "./render-page.ts";

/** Fake origin the page loads from; Playwright answers every request to it, so nothing leaves the machine. */
const ORIGIN = "http://memegen-seed.localhost";

interface TemplateRow {
  id: string;
  slug: string;
  asset_id: string;
  kind: MediaKind;
  default_layers: TextLayer[];
}

/** The templates with these slugs; fails naming any that are not imported. */
async function loadTemplates(sql: Sql, slugs: readonly string[]): Promise<Map<string, TemplateRow>> {
  const wanted = [...new Set(slugs)];
  const rows = await sql<TemplateRow[]>`
    select t.id, t.slug, t.asset_id, a.kind, t.default_layers
    from templates t join assets a on a.id = t.asset_id
    where t.slug in ${sql(wanted)}`;
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const missing = wanted.filter((s) => !bySlug.has(s));
  if (missing.length) {
    throw new Error(
      `seeded memes need templates that are not imported: ${missing.join(", ")}. ` +
        "Set SEED_TEMPLATES_FROM to a jacebrowning/memegen checkout (without --limit) and run seed again.",
    );
  }
  return bySlug;
}

/** The template's default text boxes with the meme's captions in them. */
function captionLayers(template: TemplateRow, captions: readonly string[]): TextLayer[] {
  if (captions.length > template.default_layers.length) {
    throw new Error(`${template.slug} has ${template.default_layers.length} text boxes, got ${captions.length} captions`);
  }
  return template.default_layers.map((layer, i) => ({ ...layer, text: captions[i] ?? "" }));
}

async function assetBytes(sql: Sql, store: AssetStore, id: string): Promise<{ body: Buffer; mime: string } | null> {
  const row = await findAssetRow(sql, id);
  const object = row && (await store.open(row));
  if (!row || !object) return null;
  const chunks: Uint8Array[] = [];
  for await (const chunk of object.body) chunks.push(chunk);
  return { body: Buffer.concat(chunks), mime: row.mime };
}

/** Renders every request with `render-page.ts`, in order; `titles` label the progress lines. */
async function renderAll(sql: Sql, store: AssetStore, requests: RenderRequest[], titles: readonly string[]): Promise<RenderResponse[]> {
  const dir = await mkdtemp(join(tmpdir(), "memegen-render-"));
  const browser = await chromium.launch();
  try {
    execFileSync("bun", ["build", join(import.meta.dirname, "render-page.ts"), "--target=browser", "--format=esm", `--outdir=${dir}`], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const script = await readFile(join(dir, "render-page.js"));
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/") {
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><script type="module" src="/render.js"></script>' });
      }
      if (pathname === "/render.js") return route.fulfill({ contentType: "text/javascript", body: script });
      const asset = pathname.startsWith("/assets/") && (await assetBytes(sql, store, pathname.slice("/assets/".length)));
      return asset ? route.fulfill({ contentType: asset.mime, body: asset.body }) : route.fulfill({ status: 404 });
    });
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => typeof globalThis.renderMeme === "function");
    const out: RenderResponse[] = [];
    for (const [i, req] of requests.entries()) {
      out.push(await page.evaluate((r) => globalThis.renderMeme(r), req));
      console.log(`render ${i + 1}/${requests.length} ${titles[i]}`);
    }
    return out;
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}

export interface CaptionedMeme {
  /** `templates.slug`. */
  template: string;
  /** One caption per default text box of the template, in order; missing boxes stay empty. */
  captions: readonly string[];
  title: string;
}

export interface RenderedMeme {
  template: { id: string; assetId: string };
  layers: TextLayer[];
  image: RenderResponse;
}

/**
 * Captions each meme's template and renders it, in order. Writes nothing, so a browser failure leaves the database
 * untouched; store the images with `uploadRendered` afterwards.
 */
export async function renderCaptioned(sql: Sql, store: AssetStore, memes: readonly CaptionedMeme[]): Promise<RenderedMeme[]> {
  const templates = await loadTemplates(sql, memes.map((m) => m.template));
  const captioned = memes.map((m) => {
    const t = templates.get(m.template)!;
    return { t, layers: captionLayers(t, m.captions) };
  });
  const images = await renderAll(
    sql,
    store,
    captioned.map(({ t, layers }) => ({ sourceAssetId: t.asset_id, kind: t.kind, layers, limits: store.limits })),
    memes.map((m) => m.title),
  );
  return captioned.map(({ t, layers }, i) => ({ template: { id: t.id, assetId: t.asset_id }, layers, image: images[i]! }));
}

/** Stores a rendered image as `ownerId`'s upload, named after the meme: `Friday deploys` → `friday-deploys.png`. */
export function uploadRendered(store: AssetStore, image: RenderResponse, title: string, ownerId: string): Promise<Asset> {
  return store.upload({ data: Buffer.from(image.base64, "base64"), filename: `${fileSlug(title)}${image.extension}`, ownerId });
}
