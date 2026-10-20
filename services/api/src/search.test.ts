import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { DEFAULT_LIMITS, type Page, type SearchHit, type Template, type TemplateDuplicate, type User } from "@memegen/shared";
import { HeaderAuthProvider, type Sql } from "@memegen/server-kit";
import { encodePng, freshTestDb } from "@memegen/server-kit/testing";
import { AssetStore, LocalStorageProvider, staticProviders } from "@memegen/storage";
import { createAiProviders } from "./ai/registry.ts";
import { createApiApp, type ApiApp } from "./app.ts";
import type { TemplateSearch } from "./search.ts";

let sql: Sql;
let dir: string;
let store: AssetStore;
let app: ApiApp;

/** What the search sidecar answers next. */
let textHits: SearchHit[] = [];
let similarHits: SearchHit[] = [];
const search: TemplateSearch = {
  text: async () => textHits,
  similar: async () => similarHits,
};

before(async () => {
  sql = await freshTestDb();
  dir = await mkdtemp(join(tmpdir(), "memegen-search-"));
  store = new AssetStore(sql, staticProviders(new LocalStorageProvider(dir)), DEFAULT_LIMITS);
  app = createApiApp(sql, new HeaderAuthProvider(sql), createAiProviders(), search);
});

after(async () => {
  await sql.end();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`truncate users, assets cascade`;
  textHits = [];
  similarHits = [];
});

let pngCounter = 0;
function png(fill = ++pngCounter % 256): Uint8Array {
  return encodePng(4, 4, new Uint8Array(4 * 4 * 3).fill(fill));
}

async function call<T>(path: string, user: User | null, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers["x-user-id"] = user.id;
  const res = await app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, body: (await res.json()) as T };
}

async function signIn(username: string): Promise<User> {
  return (await call<{ user: User }>("/api/session", null, { method: "POST", body: { username } })).body.user;
}

async function upload(owner: User, data = png()): Promise<string> {
  return (await store.upload({ data, filename: "t.png", ownerId: owner.id })).id;
}

async function makeTemplate(
  owner: User,
  name: string,
  opts: { tags?: string[]; isPublic?: boolean; parentId?: string; assetId?: string } = {},
): Promise<Template> {
  const { assetId, ...rest } = opts;
  const res = await call<Template>("/api/templates", owner, {
    method: "POST",
    body: { name, assetId: assetId ?? (await upload(owner)), ...rest },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

const hit = (t: Template, score = 3): SearchHit => ({ templateId: t.id, score });

async function searchNames(q: string, user: User | null, extra = ""): Promise<string[]> {
  return (await call<Page<Template>>(`/api/templates?q=${encodeURIComponent(q)}${extra}`, user)).body.items.map((t) => t.name);
}

test("template search ranks tag matches, then name matches, then image matches, each template once", async () => {
  const alice = await signIn("alice");
  const tagged = await makeTemplate(alice, "Such Wow", { tags: ["dogs"] });
  const named = await makeTemplate(alice, "Hot Dog");
  const pictured = await makeTemplate(alice, "Cheems");
  await makeTemplate(alice, "Unrelated");
  // The sidecar ranks the named template first; text matches still lead, and nothing repeats.
  textHits = [hit(named, 4), hit(pictured, 3), hit(tagged, 2.5)];
  assert.deepEqual(await searchNames("dog", alice), ["Such Wow", "Hot Dog", "Cheems"]);
});

test("image matches respect visibility and filters, and a variation's match finds its parent", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const parent = await makeTemplate(alice, "Doge");
  const variation = await makeTemplate(alice, "Doge (zoomed)", { parentId: parent.id });
  const hidden = await makeTemplate(bob, "Bob's private shiba", { isPublic: false });
  const hiddenVariation = await makeTemplate(bob, "Bob's private variation", { parentId: parent.id, isPublic: false });
  const otherTag = await makeTemplate(alice, "Shiba", { tags: ["animals"] });

  textHits = [hit(variation), hit(hidden), hit(otherTag)];
  assert.deepEqual(await searchNames("pet", alice), ["Doge", "Shiba"]);
  // Only the tag filter's templates.
  assert.deepEqual(await searchNames("pet", alice, "&tag=animals"), ["Shiba"]);
  // Bob sees his own private template.
  assert.deepEqual(await searchNames("pet", bob), ["Doge", "Bob's private shiba", "Shiba"]);
  // A private variation never surfaces its public parent for anyone else.
  textHits = [hit(hiddenVariation)];
  assert.deepEqual(await searchNames("pet", alice), []);
  assert.deepEqual(await searchNames("pet", bob), ["Doge"]);
});

test("template search pages across text and image matches", async () => {
  const alice = await signIn("alice");
  const a = await makeTemplate(alice, "Dog A");
  const b = await makeTemplate(alice, "Dog B");
  const c = await makeTemplate(alice, "Pup");
  textHits = [hit(c), hit(a)];
  const first = await call<Page<Template>>("/api/templates?q=dog&limit=2", alice);
  assert.deepEqual(first.body.items.map((t) => t.id), [b.id, a.id]);
  assert.equal(first.body.nextOffset, 2);
  const second = await call<Page<Template>>("/api/templates?q=dog&limit=2&offset=2", alice);
  assert.deepEqual(second.body.items.map((t) => t.id), [c.id]);
  assert.equal(second.body.nextOffset, null);
});

test("duplicates: exact copies first, then look-alikes, only templates the viewer can see", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const bytes = png(200);
  const original = await makeTemplate(alice, "Original", { assetId: await upload(alice, bytes) });
  const lookalike = await makeTemplate(alice, "Look-alike");
  const hiddenCopy = await makeTemplate(bob, "Bob's copy", { assetId: await upload(bob, bytes), isPublic: false });
  const upload2 = await upload(alice, bytes);
  similarHits = [hit(original, 0.99), hit(lookalike, 0.94), hit(hiddenCopy, 0.99)];

  const res = await call<TemplateDuplicate[]>(`/api/templates/duplicates?assetId=${upload2}`, alice);
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.map((d) => [d.template.name, d.exact, d.similarity]),
    [
      ["Original", true, 0.99],
      ["Look-alike", false, 0.94],
    ],
  );

  // Without the sidecar's opinion, byte-identical templates are still found.
  similarHits = [];
  const exactOnly = await call<TemplateDuplicate[]>(`/api/templates/duplicates?assetId=${upload2}`, bob);
  assert.deepEqual(
    exactOnly.body.map((d) => [d.template.name, d.exact, d.similarity]),
    [
      ["Original", true, null],
      ["Bob's copy", true, null],
    ],
  );
});

test("duplicates needs a signed-in user and an existing asset", async () => {
  const alice = await signIn("alice");
  const assetId = await upload(alice);
  assert.equal((await call(`/api/templates/duplicates?assetId=${assetId}`, null)).status, 401);
  assert.equal((await call(`/api/templates/duplicates?assetId=${crypto.randomUUID()}`, alice)).status, 404);
  assert.deepEqual((await call(`/api/templates/duplicates?assetId=${assetId}`, alice)).body, []);
});
