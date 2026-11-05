import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { limitViolations, sniff, type UploadLimits } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";
import type { AssetStore } from "@memegen/storage";
import { manifestPanelSet, type ManifestPanelTemplate } from "./manifest.ts";
import type { PanelRenderOutput } from "./render-panels-page.ts";

const ORIGIN = "http://memegen-panels.localhost";

/** One lazy browser per sequential import batch. Always close it in the batch's finally block. */
export class PanelRecipeRenderer {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private directory: string | undefined;
  private source: { body: Buffer; mime: string } | undefined;

  async render(entry: ManifestPanelTemplate, data: Uint8Array, limits: UploadLimits): Promise<PanelRenderOutput> {
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
      return await this.page.evaluate((request) => globalThis.renderPanelRecipe(request), { entry, limits });
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

/** Crop bytes only in Chromium; persist immutable assets, then publish the complete template atomically. */
export async function importPanelTemplate(
  sql: Sql,
  store: AssetStore,
  renderer: PanelRecipeRenderer,
  entry: ManifestPanelTemplate,
  data: Uint8Array,
): Promise<string> {
  const rendered = await renderer.render(entry, data, store.limits);
  const assetIds: string[] = [];
  for (const [index, crop] of rendered.crops.entries()) {
    const asset = await store.uploadOnce({
      data: Buffer.from(crop.base64, "base64"), filename: `${entry.slug.split("/").pop()}-panel-${index + 1}.png`,
      name: `${entry.title} — panel ${index + 1}`, ownerId: null,
    });
    assetIds.push(asset.id);
  }
  const cover = await store.uploadOnce({
    data: Buffer.from(rendered.cover.base64, "base64"), filename: `${entry.slug.split("/").pop()}-cover.jpg`,
    name: `${entry.title} — cover`, ownerId: null,
  });
  const { panels: defaultPanels, ...style } = manifestPanelSet(entry, assetIds);
  const packIds = [...new Set(assetIds)];
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into templates ${tx({
        slug: entry.slug, name: entry.title, asset_id: cover.id, owner_id: null,
        default_layers: tx.json([]), panels: tx.json({ ...style, defaultPanels } as never),
      })} returning id`;
    await tx`insert into template_pack_assets ${tx(packIds.map((assetId, position) => ({ template_id: row!.id, asset_id: assetId, position })))}`;
    return row!.id;
  });
}
