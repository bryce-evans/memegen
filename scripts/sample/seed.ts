/**
 * Seeds the realistic dev dataset (scripts/sample/data.ts) into DATABASE_URL; a no-op if already seeded.
 * Needs the jacebrowning templates imported first (`SEED_TEMPLATES_FROM`). Meme images are rendered by the
 * client renderer in headless Chromium (Playwright's, see README "Tests"), fully offline: the page and every
 * asset it fetches are served straight from the asset store.
 *
 *   bun run seed:sample
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { MediaKind, TextLayer } from "@memegen/shared";
import { createSql, findAssetRow, migrate, uploadLimitsFromEnv, type Sql } from "@memegen/server-kit";
import { assetStoreFromEnv, type AssetStore } from "@memegen/storage";
import { SAMPLE_MEMES, SAMPLE_TAGS, SAMPLE_USERS, type SampleMeme, type SampleUser } from "./data.ts";
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

async function isSeeded(sql: Sql): Promise<boolean> {
  const [row] = await sql`select 1 from users where lower(username) = ${SAMPLE_USERS[0]}`;
  return Boolean(row);
}

async function loadTemplates(sql: Sql): Promise<Map<string, TemplateRow>> {
  const slugs = [...new Set(SAMPLE_MEMES.map((m) => m.template))];
  const rows = await sql<TemplateRow[]>`
    select t.id, t.slug, t.asset_id, a.kind, t.default_layers
    from templates t join assets a on a.id = t.asset_id
    where t.slug in ${sql(slugs)}`;
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length) {
    throw new Error(
      `sample memes need templates that are not imported: ${missing.join(", ")}. ` +
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

/** Renders every meme's image with `scripts/sample/render-page.ts`, in SAMPLE_MEMES order. */
async function renderAll(sql: Sql, store: AssetStore, requests: RenderRequest[]): Promise<RenderResponse[]> {
  const dir = await mkdtemp(join(tmpdir(), "memegen-sample-"));
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
      console.log(`render ${i + 1}/${requests.length} ${SAMPLE_MEMES[i]!.title}`);
    }
    return out;
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function insertMeme(
  sql: Sql,
  m: SampleMeme,
  ids: { owner: string; template: TemplateRow; output: string; users: Map<SampleUser, string>; tags: Map<string, string> },
  layers: TextLayer[],
): Promise<void> {
  const at = new Date(Date.now() - m.ageHours * 3_600_000);
  const after = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
  const [row] = await sql<{ id: string }[]>`
    insert into memes ${sql({
      owner_id: ids.owner,
      template_id: ids.template.id,
      source_asset_id: ids.template.asset_id,
      output_asset_id: ids.output,
      title: m.title,
      layers: sql.json(layers as never),
      visibility: m.visibility ?? "public",
      posted_at: m.draft ? null : at,
      created_at: at,
      updated_at: at,
    })} returning id`;
  const memeId = row!.id;

  for (const slug of m.tags ?? []) {
    await sql`insert into meme_tags (meme_id, tag_id) values (${memeId}, ${ids.tags.get(slug)!})`;
  }
  const voters = SAMPLE_USERS.filter((u) => ids.users.get(u) !== ids.owner);
  if (m.up + m.down > voters.length) throw new Error(`${m.title}: ${m.up + m.down} votes but only ${voters.length} voters`);
  for (let i = 0; i < m.up + m.down; i++) {
    await sql`insert into votes (user_id, meme_id, value, created_at)
      values (${ids.users.get(voters[i]!)!}, ${memeId}, ${i < m.up ? 1 : -1}, ${after(5 + i * 7)})`;
  }
  for (const [i, user] of (m.favoritedBy ?? []).entries()) {
    await sql`insert into favorites (user_id, meme_id, created_at) values (${ids.users.get(user)!}, ${memeId}, ${after(10 + i * 11)})`;
  }
  for (const c of m.comments ?? []) {
    const [parent] = await sql<{ id: string }[]>`
      insert into comments (meme_id, author_id, body, created_at)
      values (${memeId}, ${ids.users.get(c.author)!}, ${c.body}, ${after(c.afterMinutes)}) returning id`;
    for (const r of c.replies ?? []) {
      await sql`insert into comments (meme_id, parent_id, author_id, body, created_at)
        values (${memeId}, ${parent!.id}, ${ids.users.get(r.author)!}, ${r.body}, ${after(r.afterMinutes)})`;
    }
  }
}

async function seedSample(sql: Sql, store: AssetStore): Promise<void> {
  const templates = await loadTemplates(sql);
  const layers = SAMPLE_MEMES.map((m) => captionLayers(templates.get(m.template)!, m.captions));
  const limits = uploadLimitsFromEnv();
  // Render before writing anything, so a browser failure leaves the database untouched.
  const images = await renderAll(
    sql,
    store,
    SAMPLE_MEMES.map((m, i) => {
      const t = templates.get(m.template)!;
      return { sourceAssetId: t.asset_id, kind: t.kind, layers: layers[i]!, limits };
    }),
  );

  const users = new Map<SampleUser, string>();
  for (const [i, username] of SAMPLE_USERS.entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into users (username, created_at) values (${username}, now() - ${`${500 - i * 20} days`}::interval) returning id`;
    users.set(username, row!.id);
  }
  const tags = new Map<string, string>();
  for (const t of SAMPLE_TAGS) {
    const [row] = await sql<{ id: string }[]>`
      insert into tags (slug, name, kind, description, created_by)
      values (${t.slug}, ${t.name}, 'topic', ${t.description}, ${users.get(t.createdBy)!})
      on conflict (slug) do update set slug = excluded.slug returning id`;
    tags.set(t.slug, row!.id);
  }
  for (const [i, m] of SAMPLE_MEMES.entries()) {
    const owner = users.get(m.owner)!;
    const image = images[i]!;
    const output = await store.upload({
      data: Buffer.from(image.base64, "base64"),
      filename: `${m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${image.extension}`,
      ownerId: owner,
    });
    await insertMeme(sql, m, { owner, template: templates.get(m.template)!, output: output.id, users, tags }, layers[i]!);
  }
}

const sql = createSql();
try {
  await migrate(sql);
  if (await isSeeded(sql)) {
    console.log(`sample data already present (user ${SAMPLE_USERS[0]} exists); nothing to do`);
  } else {
    await seedSample(sql, assetStoreFromEnv(sql));
    console.log(`sample data seeded: ${SAMPLE_USERS.length} users, ${SAMPLE_MEMES.length} memes`);
  }
} finally {
  await sql.end();
}
