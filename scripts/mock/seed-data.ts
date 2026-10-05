/**
 * Writes the mock dataset (users, templates + variation, tags, memes spread over time, votes) into an
 * already-migrated database. Media is generated in code, so no external files are needed.
 * Used only by e2e global setup (fresh database); dev seeds the realistic dataset in scripts/sample.
 */
import { createRequire } from "node:module";
import { deflateSync, crc32 } from "node:zlib";
import type * as Gifenc from "gifenc";
import { topBottomLayers } from "@memegen/shared";
import type { Sql } from "@memegen/server-kit";
import type { AssetStore } from "@memegen/storage";
import { insertTemplate, tagTemplate } from "../lib.ts";
import { MOCK_AUTHORS, MOCK_MEMES, MOCK_TEMPLATES, MOCK_VOTER_COUNT, mockVoter } from "./data.ts";

const { applyPalette, GIFEncoder, quantize } = createRequire(import.meta.url)("gifenc") as typeof Gifenc;

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** RGB pixels: vertical gradient in `hue` with soft diagonal stripes. */
function pixels(width: number, height: number, hue: number, shift = 0): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const stripe = Math.floor((x + y + shift) / 40) % 2 === 0 ? 0.06 : 0;
      const [r, g, b] = hsl(hue, 0.55, 0.25 + 0.35 * (y / height) + stripe);
      out.set([r, g, b], (y * width + x) * 3);
    }
  }
  return out;
}

function png(width: number, height: number, hue: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rgb = pixels(width, height, hue);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

function gif(width: number, height: number, hue: number, frames: number): Uint8Array {
  const enc = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    const rgb = pixels(width, height, hue, f * 8);
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 255], i * 4);
    const palette = quantize(rgba, 64);
    enc.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: 100 });
  }
  enc.finish();
  return enc.bytes();
}

/** Seeds the mock dataset into a fresh database. */
export async function seedMockData(sql: Sql, store: AssetStore): Promise<void> {
  const userIds = new Map<string, string>();
  const usernames = [...MOCK_AUTHORS, ...Array.from({ length: MOCK_VOTER_COUNT }, (_, i) => mockVoter(i))];
  for (const username of usernames) {
    const [row] = await sql<{ id: string }[]>`
      insert into users (username, created_at) values (${username}, now() - interval '450 days') returning id`;
    userIds.set(username, row!.id);
  }

  const templateIds = new Map<string, { id: string; assetId: string }>();
  for (const t of MOCK_TEMPLATES) {
    const ownerId = t.owner ? userIds.get(t.owner)! : null;
    const asset = await store.upload({
      data: t.gif ? gif(240, 180, t.hue, 10) : png(600, 450, t.hue),
      filename: `${t.key}${t.gif ? ".gif" : ".png"}`,
      name: t.name,
      ownerId,
    });
    const id = await insertTemplate(sql, {
      slug: `mock/${t.key}`,
      name: t.name,
      assetId: asset.id,
      layers: topBottomLayers("", ""),
      parentId: t.parent ? templateIds.get(t.parent)!.id : null,
      ownerId,
      createdAt: new Date(Date.now() - 420 * 86_400_000),
    });
    templateIds.set(t.key, { id, assetId: asset.id });
    await tagTemplate(sql, id, t.tags);
  }

  let hue = 0;
  for (const m of MOCK_MEMES) {
    const template = templateIds.get(m.template)!;
    const ownerId = userIds.get(m.owner)!;
    const animated = MOCK_TEMPLATES.find((t) => t.key === m.template)!.gif;
    hue = (hue + 47) % 360;
    // Outputs stand in for a rendered meme: animated templates reuse their GIF, stills get a tinted image.
    const outputId = animated
      ? template.assetId
      : (await store.upload({ data: png(600, 450, hue), filename: `${m.key}.png`, ownerId })).id;
    const at = new Date(Date.now() - m.ageHours * 3_600_000);
    const [row] = await sql<{ id: string }[]>`
      insert into memes ${sql({
        owner_id: ownerId,
        template_id: template.id,
        source_asset_id: template.assetId,
        output_asset_id: outputId,
        title: m.title,
        layers: sql.json(topBottomLayers(m.top, m.bottom) as never),
        visibility: m.visibility ?? "public",
        posted_at: m.draft ? null : at,
        created_at: at,
        updated_at: at,
      })} returning id`;
    if (m.up + m.down > MOCK_VOTER_COUNT) throw new Error(`${m.key} needs more mock voters`);
    for (let i = 0; i < m.up + m.down; i++) {
      await sql`insert into votes (user_id, meme_id, value, created_at)
        values (${userIds.get(mockVoter(i))!}, ${row!.id}, ${i < m.up ? 1 : -1}, ${at})`;
    }
  }
}
