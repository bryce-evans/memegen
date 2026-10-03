/**
 * Writes the mock dataset (users, templates + variation, tags, memes spread over time, votes).
 * Media is generated in code, so no external files are needed.
 *
 *   bun run seed:mock            # into DATABASE_URL (dev); refuses if already seeded
 *
 * e2e global setup calls `seedMockData` on its fresh database.
 */
import { createRequire } from "node:module";
import { deflateSync, crc32 } from "node:zlib";
import type * as Gifenc from "gifenc";
import { newTextLayer, type TextLayer } from "@memegen/shared";
import { createSql, migrate, uploadLimitsFromEnv, type Sql } from "@memegen/server-kit";
import { AssetStore, createProviders } from "@memegen/storage";
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

function topBottom(top: string, bottom: string): TextLayer[] {
  return [
    newTextLayer({ text: top, y: 0.1 }),
    newTextLayer({ text: bottom, y: 0.9 }),
  ];
}

/** Seeds the mock dataset into an already-migrated database. Not idempotent; see `isSeeded`. */
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
    const data = t.gif ? gif(240, 180, t.hue, 10) : png(600, 450, t.hue);
    const asset = await store.upload({
      data,
      filename: `${t.key}${t.gif ? ".gif" : ".png"}`,
      name: t.name,
      ownerId: t.owner ? userIds.get(t.owner)! : null,
    });
    const [row] = await sql<{ id: string }[]>`
      insert into templates ${sql({
        name: t.name,
        slug: `mock/${t.key}`,
        parent_id: t.parent ? templateIds.get(t.parent)!.id : null,
        owner_id: t.owner ? userIds.get(t.owner)! : null,
        asset_id: asset.id,
        default_layers: sql.json(topBottom("", "") as never),
        created_at: new Date(Date.now() - 420 * 86_400_000),
      })} returning id`;
    templateIds.set(t.key, { id: row!.id, assetId: asset.id });
    for (const slug of t.tags) {
      await sql`insert into template_tags (template_id, tag_id) select ${row!.id}, id from tags where slug = ${slug}`;
    }
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
        layers: sql.json(topBottom(m.top, m.bottom) as never),
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

export async function isSeeded(sql: Sql): Promise<boolean> {
  const [row] = await sql`select 1 from users where username = ${MOCK_AUTHORS[0]}`;
  return Boolean(row);
}

if (import.meta.main) {
  const sql = createSql();
  try {
    await migrate(sql);
    if (await isSeeded(sql)) {
      console.log("mock data already present (user mock-alice exists); nothing to do");
    } else {
      const store = new AssetStore(sql, createProviders(process.env.STORAGE_PROVIDER || "local"), uploadLimitsFromEnv());
      await seedMockData(sql, store);
      console.log(`mock data seeded: ${MOCK_AUTHORS.length} authors, ${MOCK_TEMPLATES.length} templates, ${MOCK_MEMES.length} memes`);
    }
  } finally {
    await sql.end();
  }
}
