import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { limitViolations, MAX_PACK_IMAGES, sniff, tagSlug, type UploadLimits } from "@memegen/shared";
import type { Sql, TransactionSql } from "@memegen/server-kit";
import type { AssetStore } from "@memegen/storage";
import { manifestPanelSet, type ManifestAdditionalImage, type ManifestPanelTemplate } from "./manifest.ts";
import type { PanelRenderOutput } from "./render-panels-page.ts";

const ORIGIN = "http://memegen-panels.localhost";

/** One lazy browser per sequential import batch. Always close it in the batch's finally block. */
export class PanelRecipeRenderer {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private directory: string | undefined;
  private source: { body: Buffer; mime: string } | undefined;

  async render(entry: ManifestPanelTemplate, data: Uint8Array, limits: UploadLimits): Promise<PanelRenderOutput> {
    return this.withSource(data, limits, (page) => page.evaluate((request) => globalThis.renderPanelRecipe(request), { entry, limits }));
  }

  async validateStill(data: Uint8Array, limits: UploadLimits): Promise<void> {
    return this.withSource(data, limits, (page) => page.evaluate((caps) => globalThis.validatePanelSource(caps), limits));
  }

  private async withSource<T>(data: Uint8Array, limits: UploadLimits, run: (page: Page) => Promise<T>): Promise<T> {
    try {
      const errors = limitViolations(data.byteLength, null, limits);
      if (errors.length) throw new Error(errors.join("; "));
      const type = sniff(data);
      if (type?.kind !== "image") throw new Error("panel source must be a still image");
      this.source = { body: Buffer.from(data.buffer, data.byteOffset, data.byteLength), mime: type.mime };
      if (!this.page) {
        this.directory = await mkdtemp(join(tmpdir(), "memegen-panels-"));
        execFileSync("bun", ["build", join(import.meta.dirname, "render-panels-page.ts"), "--target=browser", "--format=esm", `--outdir=${this.directory}`], {
          stdio: ["ignore", "ignore", "inherit"],
        });
        const script = await readFile(join(this.directory, "render-panels-page.js"));
        this.browser = await chromium.launch();
        this.page = await this.browser.newPage();
        await this.page.route(`${ORIGIN}/**`, async (route) => {
          const { pathname } = new URL(route.request().url());
          if (pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><script type="module" src="/render.js"></script>' });
          if (pathname === "/render.js") return route.fulfill({ contentType: "text/javascript", body: script });
          if (pathname === "/source" && this.source) return route.fulfill({ contentType: this.source.mime, body: this.source.body });
          return route.fulfill({ status: 404 });
        });
        await this.page.goto(`${ORIGIN}/`);
        await this.page.waitForFunction(() => typeof globalThis.renderPanelRecipe === "function");
      }
      return await run(this.page);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      this.source = undefined;
    }
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } finally {
      this.browser = undefined;
      this.page = undefined;
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
      this.directory = undefined;
      this.source = undefined;
    }
  }
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download returned HTTP ${response.status} (${url})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Pin each original's download identity; changing its URL adds a new immutable choice. */
function sourceMarker(image: ManifestAdditionalImage): string {
  const source = new URL(image.url);
  source.hash = "";
  return `--library-source-${createHash("sha256").update(source.href).digest("hex")}`;
}

async function importAdditionalImage(
  tx: TransactionSql,
  store: AssetStore,
  renderer: PanelRecipeRenderer,
  image: ManifestAdditionalImage,
): Promise<string> {
  const marker = sourceMarker(image);
  const [existing] = await tx<{ id: string; size_bytes: number | string; width: number; height: number }[]>`
    select id, size_bytes, width, height from assets
    where filename like ${`%${marker}.%`} and owner_id is null and kind = 'image'
    order by created_at, id limit 1`;
  if (existing) {
    const errors = limitViolations(Number(existing.size_bytes), { kind: "image", width: existing.width, height: existing.height, frameCount: 1 }, store.limits);
    if (errors.length) throw new Error(errors.join("; "));
    return existing.id;
  }
  const data = await download(image.url);
  await renderer.validateStill(data, store.limits);
  const filename = `${tagSlug(image.name)}${marker}${sniff(data)!.ext}`;
  // Keep provenance on this original's own asset. uploadOnce can return another asset's filename,
  // losing the source identity and requiring a download on every subsequent seed.
  const asset = await store.upload({ data, filename, name: image.name, ownerId: null });
  return asset.id;
}

/** Publish new defaults once; subsequent imports only append missing immutable pack images. */
export async function importPanelTemplate(
  sql: Sql,
  store: AssetStore,
  renderer: PanelRecipeRenderer,
  entry: ManifestPanelTemplate,
): Promise<string> {
  return sql.begin(async (tx) => {
    // Serialize library pack imports, including original provenance uploads shared across recipes.
    // The pack PK protects asset membership, but the DB has no unique position constraint.
    await tx`select pg_advisory_xact_lock(hashtextextended('library:panel-import', 0))`;
    const [existing] = await tx<{ id: string; managed: boolean; is_panel: boolean }[]>`
      select id, owner_id = memegen_user_id() as managed, panels is not null as is_panel
      from templates where slug = ${entry.slug} for update`;
    if (existing && (!existing.managed || !existing.is_panel)) {
      throw new Error("existing template is not a managed panel recipe");
    }
    const current = existing ? await tx<{ asset_id: string; position: number }[]>`
      select asset_id, position from template_pack_assets where template_id = ${existing.id} order by position` : [];
    const packIds = new Set(current.map((asset) => asset.asset_id));
    const defaultIds: string[] = [];
    let coverId: string | undefined;
    if (!existing) {
      const rendered = await renderer.render(entry, await download(entry.url), store.limits);
      for (const [index, crop] of rendered.crops.entries()) {
        const asset = await store.uploadOnce({
          data: Buffer.from(crop.base64, "base64"), filename: `${entry.slug.split("/").pop()}-panel-${index + 1}.png`,
          name: `${entry.title} — panel ${index + 1}`, ownerId: null,
        });
        defaultIds.push(asset.id);
        packIds.add(asset.id);
      }
      const cover = await store.uploadOnce({
        data: Buffer.from(rendered.cover.base64, "base64"), filename: `${entry.slug.split("/").pop()}-cover.jpg`,
        name: `${entry.title} — cover`, ownerId: null,
      });
      coverId = cover.id;
    }
    for (const image of entry.panels.additionalImages ?? []) {
      packIds.add(await importAdditionalImage(tx, store, renderer, image));
    }
    if (packIds.size > MAX_PACK_IMAGES) throw new Error(`pack may contain at most ${MAX_PACK_IMAGES} images`);
    let id = existing?.id;
    if (!id) {
      const { panels: defaultPanels, ...style } = manifestPanelSet(entry, defaultIds);
      const [row] = await tx<{ id: string }[]>`
        insert into templates ${tx({
          slug: entry.slug, name: entry.title, asset_id: coverId!, owner_id: null,
          default_layers: tx.json([]), panels: tx.json({ ...style, defaultPanels } as never),
        })} returning id`;
      id = row!.id;
    }
    const currentIds = new Set(current.map((asset) => asset.asset_id));
    const missing = [...packIds].filter((assetId) => !currentIds.has(assetId));
    const nextPosition = current.reduce((next, asset) => Math.max(next, asset.position + 1), 0);
    if (missing.length) {
      await tx`insert into template_pack_assets ${tx(missing.map((assetId, index) => ({
        template_id: id, asset_id: assetId, position: nextPosition + index,
      })))}`;
    }
    return id;
  });
}
