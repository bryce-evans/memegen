import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { DEFAULT_LIMITS, type PanelTemplate } from "@memegen/shared";
import { encodePng, freshTestDb } from "@memegen/server-kit/testing";
import { AssetStore, LocalStorageProvider, staticProviders } from "@memegen/storage";
import { insertTemplate } from "../scripts/lib.ts";
import { addRegistryAliases, type Registry } from "./registry.ts";
import { importManifest } from "./import-manifest.ts";
import { importPanelTemplate, PanelRecipeRenderer } from "./import-panels.ts";
import type { ManifestPanelTemplate } from "./manifest.ts";

const recipe: ManifestPanelTemplate = {
  slug: "online/croptest", title: "Crop test", url: "https://example.com/sheet.png", source: "https://example.com/source",
  tags: ["crop-test"], risk: 2, rating_tags: ["general-audience"], layout: "panels",
  panels: {
    layout: "vertical", grid: false, mirror: true, fontSize: 0.12,
    items: [
      { crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 }, text: "First" },
      { crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, text: "Second" },
      { crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 }, text: "Again" },
    ],
  },
};

const rgb = new Uint8Array(8 * 4 * 3);
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 8; x++) rgb.set(x < 4 ? [0, 255, 0] : y < 2 ? [255, 0, 0] : [0, 0, 255], (y * 8 + x) * 3);
}
const sheet = encodePng(8, 4, rgb);

test("online panel import crops the sheet, persists native ordered panels, and resumes without changing flat templates", async () => {
  const sql = await freshTestDb();
  const directory = await mkdtemp(join(tmpdir(), "memegen-panel-import-test-"));
  const store = new AssetStore(sql, staticProviders(new LocalStorageProvider(directory)), DEFAULT_LIMITS);
  let downloads = 0;
  const server = createServer((_req, res) => {
    downloads++;
    res.writeHead(200, { "content-type": "image/png" }).end(sheet);
  });
  const renderer = new PanelRecipeRenderer();
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const entry = { ...recipe, url: `http://127.0.0.1:${address.port}/sheet.png` };
    const denied = { ...entry, slug: "online/deniedcrop", risk: 5 };
    const registry: Registry = {
      policy: { version: 1, duplicates: [], aliases: [] }, catalog: [entry, denied], selected: [entry, denied],
      maxRisk: 2, checkoutEnabled: false, onlineEnabled: true,
    };
    const original = await store.uploadOnce({ data: sheet, filename: "flat.png", ownerId: null });
    const flatId = await insertTemplate(sql, { slug: "online/flatcrop", name: "Original flat", assetId: original.id, layers: [] });
    await addRegistryAliases(sql, flatId, entry); // A legacy flat alias must not swallow the new recipe identity.
    const flatBefore = await sql`select * from templates where id = ${flatId}`;
    await importManifest(sql, registry, Infinity, store);
    assert.equal(downloads, 1);
    const [row] = await sql<{ id: string; asset_id: string; kind: string; panels: Omit<PanelTemplate, "pack">; default_layers: unknown[] }[]>`
      select id, asset_id, kind, panels, default_layers from templates where slug = ${entry.slug}`;
    assert.ok(row);
    assert.equal(row.kind, "multi");
    assert.notEqual(row.asset_id, original.id);
    assert.deepEqual(row.default_layers, []);
    const pack = await sql<{ id: string; position: number; width: number; height: number; mime: string; storage_key: string }[]>`
      select a.id, p.position, a.width, a.height, a.mime, a.storage_key
      from template_pack_assets p join assets a on a.id = p.asset_id where p.template_id = ${row.id} order by p.position`;
    assert.deepEqual(pack.map(({ position, width, height, mime }) => ({ position, width, height, mime })), [
      { position: 0, width: 4, height: 2, mime: "image/png" },
      { position: 1, width: 4, height: 2, mime: "image/png" },
    ]);
    assert.deepEqual(row.panels, {
      layout: "vertical", grid: false, mirror: true, fontSize: 0.12,
      defaultPanels: [
        { id: "panel-1", assetId: pack[0]!.id, text: "First" },
        { id: "panel-2", assetId: pack[1]!.id, text: "Second" },
        { id: "panel-3", assetId: pack[0]!.id, text: "Again" },
      ],
    });
    const [cover] = await sql<{ width: number; height: number; mime: string }[]>`select width, height, mime from assets where id = ${row.asset_id}`;
    assert.deepEqual(cover, { width: 1200, height: 900, mime: "image/jpeg" });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const pngs = await Promise.all(pack.map(async (asset) => (await readFile(join(directory, asset.storage_key))).toString("base64")));
      const pixels = await page.evaluate(async (images) => {
        const result: number[][] = [];
        for (const base64 of images) {
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          result.push([...context.getImageData(0, 0, bitmap.width, bitmap.height).data]);
          bitmap.close();
        }
        return result;
      }, pngs);
      assert.deepEqual(pixels, [Array.from({ length: 8 }, () => [255, 0, 0, 255]).flat(), Array.from({ length: 8 }, () => [0, 0, 255, 255]).flat()]);
    } finally {
      await browser.close();
    }
    const assetsBefore = await sql`select id, sha256 from assets order by id`;
    const templatesBefore = await sql`select * from templates order by id`;
    await importManifest(sql, registry, Infinity, store);
    assert.equal(downloads, 1, "resuming does not download the sheet again");
    assert.deepEqual(await sql`select * from templates order by id`, templatesBefore);
    assert.deepEqual(await sql`select id, sha256 from assets order by id`, assetsBefore);
    assert.deepEqual(await sql`select * from templates where id = ${flatId}`, flatBefore);
    assert.equal((await sql`select id from templates where slug = ${denied.slug}`).length, 0);

    // A database failure while adding the pack must not publish a half-created template.
    await sql`create function reject_test_pack() returns trigger language plpgsql as $$ begin raise exception 'reject test pack'; end $$`;
    await sql`create trigger reject_test_pack before insert on template_pack_assets for each row execute function reject_test_pack()`;
    const retried = { ...entry, slug: "online/retrycrop" };
    await assert.rejects(importPanelTemplate(sql, store, renderer, retried, sheet), /reject test pack/);
    assert.equal((await sql`select id from templates where slug = ${retried.slug}`).length, 0);
    await sql`drop trigger reject_test_pack on template_pack_assets`;
    await sql`drop function reject_test_pack()`;
    const retryId = await importPanelTemplate(sql, store, renderer, retried, sheet);
    assert.deepEqual((await sql<{ position: number }[]>`select position from template_pack_assets where template_id = ${retryId} order by position`).map((item) => item.position), [0, 1]);
  } finally {
    await renderer.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await sql.end();
    await rm(directory, { recursive: true, force: true });
  }
});

test("panel ingestion rejects animated sources and caps before storing cropped outputs", async () => {
  const renderer = new PanelRecipeRenderer();
  try {
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    await assert.rejects(renderer.render(recipe, gif, DEFAULT_LIMITS), /still image/);
    await assert.rejects(renderer.render(recipe, sheet, { ...DEFAULT_LIMITS, maxBytes: 12 }), /max is/);
    await assert.rejects(renderer.render(recipe, sheet, { ...DEFAULT_LIMITS, image: { maxDimension: 4 } }), /longest edge max is 4px/);
    const recovered = await renderer.render(recipe, sheet, DEFAULT_LIMITS);
    assert.deepEqual(recovered.crops.map(({ width, height }) => ({ width, height })), [
      { width: 4, height: 2 }, { width: 4, height: 2 }, { width: 4, height: 2 },
    ]);
  } finally {
    await renderer.close();
  }
});
