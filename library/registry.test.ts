import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshTestDb } from "@memegen/server-kit/testing";
import { insertMeme, insertTemplate, tagTemplate, upsertTag } from "../scripts/lib.ts";
import { addRegistryAliases, checkoutAllowed, loadRegistry, reconcileRegistry, rootVisibility, type Registry } from "./registry.ts";
import type { ManifestTemplate } from "./manifest.ts";

const safe: ManifestTemplate = {
  slug: "online/safe", title: "Ordinary couple", tags: ["romance"], risk: 2, rating_tags: ["general-audience"],
  url: "https://example.com/safe.jpg", source: "https://example.com/safe", layout: "impact",
  text: [{ text: "Hello", x: 0.5, y: 0.1, maxWidth: 1, maxHeight: 0.2 }],
};
const adult: ManifestTemplate = { ...safe, slug: "online/adult", title: "Adult format", tags: ["adult-topic"], risk: 5, rating_tags: ["sex"] };
const checkout: ManifestTemplate = { ...safe, slug: "jb/safe", tags: ["oldschool", "source-keyword"] };
const unsafeCheckout: ManifestTemplate = { ...adult, slug: "jb/apcr" };
function registry(maxRisk = 2): Registry {
  return {
    policy: {
      version: 1,
      duplicates: [
        { slug: "online/old", canonicalSlug: "jb/safe" },
        { slug: "online/retiredadult", canonicalSlug: "jb/safe" },
        { slug: "online/freshalias", canonicalSlug: "jb/safe" },
        { slug: "jb/retired", canonicalSlug: "online/safe" },
      ],
      aliases: [
        { slug: "online/old", title: "Historic Safe Name", tags: ["historic-safe"], risk: 2, rating_tags: ["general-audience"] },
        { slug: "online/freshalias", title: "Another safe title", tags: ["fresh-alias-topic"], risk: 2, rating_tags: ["general-audience"] },
        { slug: "online/retiredadult", title: "Retired adult", tags: ["unsafe-legacy"], risk: 5, rating_tags: ["sex"] },
        { slug: "jb/retired", title: "Retired checkout", tags: ["checkout-alias"], risk: 2, rating_tags: ["general-audience"] },
      ],
    },
    catalog: [safe, adult, checkout, unsafeCheckout], selected: [safe, adult, checkout, unsafeCheckout].filter((entry) => entry.risk <= maxRisk),
    maxRisk, checkoutEnabled: true, onlineEnabled: true,
  };
}

test("canonical safety outranks unsafe aliases; disabled registries leave unrelated built-ins alone", () => {
  const state = registry();
  const root = { id: "id", slug: "jb/safe", name: "Safe", identities: ["online-adult", "online-retiredadult"] };
  assert.equal(rootVisibility(state, root), true);
  assert.equal(rootVisibility(state, { ...root, slug: "jb/apcr", identities: [] }), false);
  assert.equal(rootVisibility(state, { ...root, slug: "jb/unreviewed", identities: [] }), false);
  assert.equal(rootVisibility(state, { ...root, slug: "custom/built-in", identities: [] }), undefined);
  assert.equal(rootVisibility(state, { ...root, slug: "online/old", identities: [] }), false);
  assert.equal(rootVisibility({ ...state, checkoutEnabled: false, onlineEnabled: false }, root), undefined);
  assert.equal(rootVisibility(state, { ...root, slug: null, identities: ["online-adult"] }), false);
  assert.equal(rootVisibility(registry(5), { ...root, slug: null, identities: ["online-retiredadult"] }), false);
  assert.equal(rootVisibility(state, { ...root, slug: "jb/apcr", identities: ["online-safe"] }), false);
  assert.equal(rootVisibility(state, { ...root, slug: safe.slug }), true);
  assert.equal(rootVisibility(state, { ...root, slug: adult.slug, identities: ["online-safe"] }), false);
  assert.equal(rootVisibility({ ...state, checkoutEnabled: false }, root), true, "catalog alone enables checkout roots");
  assert.equal(rootVisibility({ ...state, onlineEnabled: false }, root), true, "local import alone enables checkout roots");
  assert.equal(checkoutAllowed(state, "jb/safe"), true);
  assert.equal(checkoutAllowed(state, "jb/retired"), false, "retired checkout aliases are never seeded again");
  assert.equal(rootVisibility(state, { ...root, slug: "jb/retired" }), false);
  assert.equal(rootVisibility(state, { ...root, slug: null, identities: ["jb-safe"] }), true);
});

test("every risk ceiling applies to checkout, direct online roots, and legacy identities", () => {
  for (let maxRisk = 1; maxRisk <= 5; maxRisk++) {
    const state = registry(maxRisk);
    for (let risk = 1; risk <= 5; risk++) {
      const slug = `online/risk${risk}`;
      state.catalog.push({ ...safe, slug, risk });
      state.catalog.push({ ...checkout, slug: `jb/risk${risk}`, risk });
      const root = { id: "id", slug, name: "Rated", identities: [] };
      assert.equal(checkoutAllowed(state, `jb/risk${risk}`), risk <= maxRisk);
      assert.equal(rootVisibility(state, root), risk <= maxRisk);
      assert.equal(rootVisibility(state, { ...root, slug: null, identities: [`online-risk${risk}`] }), risk <= maxRisk);
      assert.equal(rootVisibility({ ...state, onlineEnabled: false }, root), risk <= maxRisk ? undefined : false);
    }
  }
});

test("custom manifests are filtered and rejected entries remain managed; invalid ceilings fail strictly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memegen-registry-"));
  const manifest = join(directory, "custom.json");
  const previous = process.env.SEED_MAX_RISK;
  try {
    const templates = [1, 2, 3, 4, 5].map((risk) => ({
      ...safe, slug: `online/customrisk${risk}`, risk, url: `https://example.com/custom${risk}.jpg`,
    }));
    await writeFile(manifest, JSON.stringify({ version: 1, sources: [{ name: "Test", url: "https://example.com" }], templates }));
    delete process.env.SEED_MAX_RISK;
    assert.deepEqual((await loadRegistry({ manifest })).selected.map((entry) => entry.risk), [1, 2, 3]);
    for (let maxRisk = 1; maxRisk <= 5; maxRisk++) {
      process.env.SEED_MAX_RISK = String(maxRisk);
      const state = await loadRegistry({ manifest });
      assert.deepEqual(state.selected.map((entry) => entry.risk), templates.filter((entry) => entry.risk <= maxRisk).map((entry) => entry.risk));
      for (const entry of templates) {
        assert.equal(rootVisibility(state, { id: "id", slug: entry.slug, name: entry.title, identities: [] }), entry.risk <= maxRisk);
      }
    }
    process.env.SEED_MAX_RISK = "2";
    const disabled = await loadRegistry({ manifest: "" });
    assert.deepEqual(disabled.selected, []);
    assert.equal(disabled.onlineEnabled, false);
    const builtinCheckout = disabled.catalog.find((entry) => entry.slug.startsWith("jb/") && entry.risk === 2)!;
    const root = { id: "id", slug: builtinCheckout.slug, name: builtinCheckout.title, identities: [] };
    assert.equal(rootVisibility({ ...disabled, checkoutEnabled: false }, root), undefined);
    assert.equal(rootVisibility({ ...disabled, checkoutEnabled: true }, root), true);
    const lowered = { ...builtinCheckout, risk: 1, url: "https://example.com/checkout.jpg" };
    await writeFile(manifest, JSON.stringify({ version: 1, sources: [{ name: "Test", url: "https://example.com" }], templates: [lowered] }));
    const overridden = await loadRegistry({ manifest, checkoutEnabled: false });
    assert.equal(rootVisibility(overridden, root), true);
    process.env.SEED_MAX_RISK = "1";
    const loweredRisk = await loadRegistry({ manifest, checkoutEnabled: true });
    assert.deepEqual(loweredRisk.selected, [], "custom manifests cannot lower a checkout's reviewed risk");
    assert.equal(checkoutAllowed(loweredRisk, builtinCheckout.slug), false);
    const restrictedCheckout = { ...builtinCheckout, risk: 5 };
    await writeFile(manifest, JSON.stringify({ version: 1, sources: [{ name: "Test", url: "https://example.com" }], templates: [restrictedCheckout] }));
    const restricted = await loadRegistry({ manifest, checkoutEnabled: true });
    assert.deepEqual(restricted.selected, []);
    assert.equal(checkoutAllowed(restricted, builtinCheckout.slug), false);
    assert.equal(rootVisibility(restricted, root), false);
    const retired = disabled.policy.aliases.find((entry) => entry.risk === 5)!;
    await writeFile(manifest, JSON.stringify({
      version: 1, sources: [{ name: "Test", url: "https://example.com" }],
      templates: [{ ...safe, slug: retired.slug, risk: 1 }],
    }));
    assert.deepEqual((await loadRegistry({ manifest })).selected, [], "retired aliases retain their reviewed risk in custom manifests");
    for (const invalid of ["", "0", "6", "-1", "2.0", "2.5", "02", " 2", "2 ", "true", "NaN", "Infinity"]) {
      process.env.SEED_MAX_RISK = invalid;
      await assert.rejects(loadRegistry({ manifest }), /SEED_MAX_RISK must be an integer from 1 to 5/);
    }
  } finally {
    if (previous === undefined) delete process.env.SEED_MAX_RISK;
    else process.env.SEED_MAX_RISK = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("policy transitions retain saved memes and bytes, scope ownership, and clean unsafe seed aliases", async () => {
  const sql = await freshTestDb();
  try {
    const [owner] = await sql<{ id: string }[]>`insert into users (username) values ('registry-reader') returning id`;
    const [asset] = await sql<{ id: string }[]>`
      insert into assets (kind, mime, name, filename, size_bytes, sha256, provider, storage_key, width, height)
      values ('image', 'image/png', 'fixture', 'fixture.png', 1, 'registry-fixture', 'local', 'registry-fixture', 1, 1)
      returning id`;
    const make = (slug: string, parentId?: string, ownerId?: string) => insertTemplate(sql, {
      slug, name: slug, assetId: asset!.id, layers: [], parentId, ownerId,
    });
    const canonical = await make("jb/safe");
    const safeChild = await make("jb/safe/variant.png", canonical);
    const unsafe = await make("jb/apcr");
    const unsafeChild = await make("jb/apcr/variant.png", unsafe);
    const duplicate = await make("online/old");
    const adultRow = await make(adult.slug);
    const unreviewed = await make("jb/unreviewed");
    const custom = await make("custom/built-in");
    const userTemplate = await make("custom/user", undefined, owner!.id);
    const userChild = await make("custom/user-child", unsafe, owner!.id);
    const meme = await insertMeme(sql, {
      ownerId: owner!.id, template: { id: unsafe, assetId: asset!.id }, outputAssetId: asset!.id,
      title: "Saved before policy change", layers: [], ageHours: 1,
    });
    const [before] = await sql`select * from memes where id = ${meme.id}`;
    await sql`update templates set is_public = false where id in ${sql([canonical, safeChild, custom, userTemplate])}`;
    await addRegistryAliases(sql, canonical, adult);
    await addRegistryAliases(sql, canonical, registry().policy.aliases[2]!);
    await upsertTag(sql, { slug: "user-topic", name: "User topic", kind: "topic", createdBy: owner!.id });
    await tagTemplate(sql, canonical, ["user-topic"]);
    await sql`update template_tags set base = false where template_id = ${canonical}
      and tag_id = (select id from tags where slug = 'user-topic')`;
    const visibility = async () => Object.fromEntries((await sql<{ id: string; is_public: boolean }[]>`
      select id, is_public from templates`).map((row) => [row.id, row.is_public]));
    await reconcileRegistry(sql, registry());
    let visible = await visibility();
    for (const id of [canonical, safeChild, userChild]) assert.equal(visible[id], true);
    for (const id of [unsafe, unsafeChild, duplicate, adultRow, unreviewed, custom, userTemplate]) assert.equal(visible[id], false);
    const tags = (await sql<{ slug: string }[]>`select g.slug from tags g join template_tags tt on tt.tag_id = g.id
      where tt.template_id = ${canonical}`).map((row) => row.slug);
    for (const slug of ["oldschool", "source-keyword", "jb-safe"]) {
      assert.ok(tags.includes(slug), `${slug}: existing checkout roots receive canonical catalog metadata`);
    }
    assert.ok(tags.includes("online-old"), "safe retired identity remains searchable on its canonical");
    assert.ok(tags.includes("user-topic"), "user tags survive reconciliation");
    assert.ok(tags.includes("historic-safe"));
    assert.ok(tags.includes("historic-safe-name"));
    assert.ok(tags.includes("another-safe-title"), "fresh seeds retain aliases without an old row");
    assert.ok(tags.includes("fresh-alias-topic"));
    for (const slug of ["online-adult", "adult-format", "adult-topic", "online-retiredadult", "retired-adult", "unsafe-legacy"]) {
      assert.equal(tags.includes(slug), false, slug);
    }
    await reconcileRegistry(sql, registry(5));
    visible = await visibility();
    for (const id of [unsafe, unsafeChild, adultRow]) assert.equal(visible[id], true);
    assert.equal(visible[duplicate], false);
    const [contamination] = await sql<{ count: number }[]>`
      select count(*)::int as count from template_tags tt join tags g on g.id = tt.tag_id
      where tt.template_id = ${canonical} and g.slug in ('online-retiredadult', 'unsafe-legacy', 'online-adult')`;
    assert.equal(contamination!.count, 0, "raising the ceiling must not attach higher-risk aliases to lower-risk roots");
    await reconcileRegistry(sql, registry());
    visible = await visibility();
    assert.equal(visible[unsafe], false);
    assert.equal(visible[unsafeChild], false);
    const [after] = await sql`select * from memes where id = ${meme.id}`;
    assert.deepEqual(after, before);
    const [retained] = await sql`select asset_id, default_layers from templates where id = ${unsafe}`;
    assert.equal(retained!.asset_id, asset!.id);
    assert.deepEqual(retained!.default_layers, []);
  } finally {
    await sql.end();
  }
});
