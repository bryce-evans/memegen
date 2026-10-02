import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import {
  DEFAULT_LIMITS,
  newTextLayer,
  type HotTemplate,
  type Meme,
  type Page,
  type Template,
  type Tag,
  type TemplateUsage,
  type User,
} from "@memegen/shared";
import { config, HeaderAuthProvider, type Sql } from "@memegen/server-kit";
import { freshTestDb } from "@memegen/server-kit/testing";
import { AssetStore, LocalStorageProvider, staticProviders } from "@memegen/storage";
import { createApiApp, type ApiApp } from "./app.ts";

let sql: Sql;
let dir: string;
let store: AssetStore;
let app: ApiApp;

before(async () => {
  sql = await freshTestDb();
  dir = await mkdtemp(join(tmpdir(), "memegen-api-"));
  store = new AssetStore(sql, staticProviders(new LocalStorageProvider(dir)), DEFAULT_LIMITS);
  app = createApiApp(sql, new HeaderAuthProvider(sql));
});

after(async () => {
  await sql.end();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`truncate users, assets, templates, memes, votes cascade`;
});

let pngCounter = 0;
/** Unique tiny PNG so each upload is a distinct file. */
function png(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  const raw = Buffer.alloc(5 * 4, ++pngCounter % 256);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

async function call<T>(method: string, path: string, user: User | null, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers["x-user-id"] = user.id;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? (null as T) : ((await res.json()) as T) };
}

async function signIn(username: string): Promise<User> {
  return (await call<{ user: User }>("POST", "/api/session", null, { username })).body.user;
}

async function makeMeme(owner: User, opts: { post?: boolean; visibility?: "public" | "private" } = {}): Promise<Meme> {
  const source = await store.upload({ data: png(), filename: "s.png", ownerId: owner.id });
  const output = await store.upload({ data: png(), filename: "o.png", ownerId: owner.id });
  const res = await call<Meme>("POST", "/api/memes", owner, {
    sourceAssetId: source.id,
    outputAssetId: output.id,
    layers: [newTextLayer()],
    visibility: opts.visibility ?? "public",
    post: opts.post ?? true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function setScore(memeId: string, score: number) {
  await sql`update memes set upvotes = ${Math.max(score, 0)}, downvotes = ${Math.max(-score, 0)} where id = ${memeId}`;
}

test("session is find-or-create by case-insensitive username", async () => {
  const a = await signIn("Alice");
  const b = await signIn("alice");
  assert.equal(a.id, b.id);
  assert.equal(b.username, "Alice");
});

test("stats: h-score and secret negative h-score over posted memes only", async () => {
  const alice = await signIn("alice");
  for (const score of [3, 3, 1, -2, -2, -2, 0]) await setScore((await makeMeme(alice)).id, score);
  await setScore((await makeMeme(alice, { post: false })).id, 50); // drafts don't count

  const pub = await call<{ stats: Record<string, number> }>("GET", "/api/users/alice", null);
  assert.deepEqual(pub.body.stats, { memeCount: 7, highScore: 3, hScore: 2 });
  assert.equal("negativeHScore" in pub.body.stats, false);

  const internal = await app.request("/internal/users/alice/stats", {
    headers: { "x-internal-token": config.internalToken },
  });
  assert.equal(((await internal.json()) as Record<string, number>).negativeHScore, 2);
});

test("h-score boundary: h memes with score exactly h", async () => {
  const bob = await signIn("bob");
  for (const score of [3, 3, 3, 2]) await setScore((await makeMeme(bob)).id, score);
  const res = await call<{ stats: { hScore: number } }>("GET", "/api/users/bob", null);
  assert.equal(res.body.stats.hScore, 3);
});

test("templates allow exactly one level of variations", async () => {
  const alice = await signIn("alice");
  const asset = async () => (await store.upload({ data: png(), filename: "t.png", ownerId: alice.id })).id;
  const parent = await call<Template>("POST", "/api/templates", alice, { name: "Base", assetId: await asset() });
  assert.equal(parent.status, 201);
  const variation = await call<Template>("POST", "/api/templates", alice, {
    name: "Tweak",
    assetId: await asset(),
    parentId: parent.body.id,
  });
  assert.equal(variation.status, 201);
  const nested = await call<{ error: string }>("POST", "/api/templates", alice, {
    name: "Nested",
    assetId: await asset(),
    parentId: variation.body.id,
  });
  assert.equal(nested.status, 400);

  const list = await call<Page<Template>>("GET", "/api/templates", null);
  assert.deepEqual(list.body.items.map((t) => [t.name, t.variations.map((v) => v.name)]), [["Base", ["Tweak"]]]);

  // The DB trigger also guards direct writes: a parent with variations can't become a variation.
  const other = await call<Template>("POST", "/api/templates", alice, { name: "Other", assetId: await asset() });
  await assert.rejects(sql`update templates set parent_id = ${other.body.id} where id = ${parent.body.id}`, /has variations/);
});

test("private memes and drafts are hidden from others but visible to the owner", async () => {
  const alice = await signIn("alice");
  const eve = await signIn("eve");
  const priv = await makeMeme(alice, { visibility: "private" });
  const draft = await makeMeme(alice, { post: false });
  const pub = await makeMeme(alice);

  assert.equal((await call("GET", `/api/memes/${priv.id}`, eve)).status, 404);
  assert.equal((await call("GET", `/api/memes/${priv.id}`, alice)).status, 200);

  const gallery = await call<Page<Meme>>("GET", "/api/gallery?period=all", eve);
  assert.deepEqual(gallery.body.items.map((m) => m.id), [pub.id]);

  const asOther = await call<Page<Meme>>("GET", "/api/users/alice/memes", eve);
  assert.deepEqual(asOther.body.items.map((m) => m.id), [pub.id]);
  const asOwner = await call<Page<Meme>>("GET", "/api/users/alice/memes", alice);
  assert.deepEqual(new Set(asOwner.body.items.map((m) => m.id)), new Set([priv.id, draft.id, pub.id]));
});

test("votes: one per user, switchable, removable; drafts can't be voted on", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const meme = await makeMeme(alice);
  const vote = (u: User, value: number) => call<Meme>("PUT", `/api/memes/${meme.id}/vote`, u, { value });

  assert.equal((await vote(bob, 1)).body.score, 1);
  assert.equal((await vote(bob, 1)).body.score, 1);
  const switched = (await vote(bob, -1)).body;
  assert.deepEqual([switched.upvotes, switched.downvotes, switched.myVote], [0, 1, -1]);
  assert.equal((await vote(alice, -1)).body.score, -2);
  const cleared = (await vote(bob, 0)).body;
  assert.deepEqual([cleared.score, cleared.myVote], [-1, 0]);

  const draft = await makeMeme(alice, { post: false });
  assert.equal((await call("PUT", `/api/memes/${draft.id}/vote`, bob, { value: 1 })).status, 400);
});

test("gallery: period windows by post time, best sorts by score", async () => {
  const alice = await signIn("alice");
  const recentLow = await makeMeme(alice);
  const recentHigh = await makeMeme(alice);
  const lastWeek = await makeMeme(alice);
  await setScore(recentLow.id, 1);
  await setScore(recentHigh.id, 5);
  await setScore(lastWeek.id, 100);
  await sql`update memes set posted_at = now() - interval '3 days' where id = ${lastWeek.id}`;

  const ids = async (q: string) => (await call<Page<Meme>>("GET", `/api/gallery?${q}`, null)).body.items.map((m) => m.id);
  assert.deepEqual(await ids("period=day&sort=best"), [recentHigh.id, recentLow.id]);
  assert.deepEqual(await ids("period=week&sort=best"), [lastWeek.id, recentHigh.id, recentLow.id]);
  assert.deepEqual(await ids("period=week&sort=new"), [recentHigh.id, recentLow.id, lastWeek.id]);
});

test("memes require the rendered output to be uploaded by the author", async () => {
  const alice = await signIn("alice");
  const eve = await signIn("eve");
  const source = await store.upload({ data: png(), filename: "s.png", ownerId: alice.id });
  const aliceOutput = await store.upload({ data: png(), filename: "o.png", ownerId: alice.id });
  const res = await call("POST", "/api/memes", eve, {
    sourceAssetId: source.id,
    outputAssetId: aliceOutput.id,
    layers: [],
  });
  assert.equal(res.status, 403);
});

test("template usage: variations roll up to the parent, history survives deletion, windows apply", async () => {
  const alice = await signIn("alice");
  const asset = async () => (await store.upload({ data: png(), filename: "t.png", ownerId: alice.id })).id;
  const base = (await call<Template>("POST", "/api/templates", alice, { name: "Base", assetId: await asset() })).body;
  const tweak = (
    await call<Template>("POST", "/api/templates", alice, { name: "Tweak", assetId: await asset(), parentId: base.id })
  ).body;
  const cold = (await call<Template>("POST", "/api/templates", alice, { name: "Cold", assetId: await asset() })).body;

  const useTemplate = async (templateId: string, post: boolean) => {
    const output = await store.upload({ data: png(), filename: "o.png", ownerId: alice.id });
    return (
      await call<Meme>("POST", "/api/memes", alice, { templateId, outputAssetId: output.id, layers: [], post })
    ).body;
  };
  await useTemplate(base.id, true);
  const fromVariation = await useTemplate(tweak.id, false);
  await useTemplate(tweak.id, false);
  const old = await useTemplate(cold.id, true);
  await sql`update template_uses set created_at = now() - interval '20 days' where meme_id = ${old.id}`;

  // Posting later records a 'posted' use; deleting the meme keeps its history.
  await call("POST", `/api/memes/${fromVariation.id}/post`, alice);
  await call("DELETE", `/api/memes/${fromVariation.id}`, alice);

  const hot = await call<HotTemplate[]>("GET", "/api/templates/hot?period=week", null);
  assert.deepEqual(hot.body.map((h) => [h.template.name, h.uses, h.posts]), [["Base", 3, 2]]);
  const month = await call<HotTemplate[]>("GET", "/api/templates/hot?period=month", null);
  assert.deepEqual(month.body.map((h) => h.template.name), ["Base", "Cold"]);

  const detail = (await call<Template>("GET", `/api/templates/${base.id}`, null)).body;
  assert.equal(detail.useCount, 3);
  assert.equal(detail.variations[0]!.useCount, 2);

  const usage = (await call<TemplateUsage>("GET", `/api/templates/${base.id}/usage?period=week`, null)).body;
  assert.equal(usage.bucket, "day");
  assert.equal(usage.points.length, 8);
  assert.deepEqual(usage.points.at(-1)!, { at: usage.points.at(-1)!.at, uses: 3, posts: 2 });
});

test("tags: normalized, inherited from templates (and variations), filter templates and gallery", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const asset = async () => (await store.upload({ data: png(), filename: "t.png", ownerId: alice.id })).id;
  const team = await call<Tag>("POST", "/api/tags", alice, { name: "Google Memes!", kind: "team" });
  assert.deepEqual([team.status, team.body.slug, team.body.kind], [201, "google-memes", "team"]);
  assert.equal((await call("POST", "/api/tags", alice, { name: "google memes" })).status, 409);

  const base = (await call<Template>("POST", "/api/templates", alice, { name: "Base", assetId: await asset() })).body;
  const variation = (
    await call<Template>("POST", "/api/templates", alice, {
      name: "Scene",
      assetId: await asset(),
      parentId: base.id,
      tags: ["Movie", "movie", "Brand New"],
    })
  ).body;
  assert.deepEqual(variation.tags, ["brand-new", "movie"]);
  const plain = (await call<Template>("POST", "/api/templates", alice, { name: "Plain", assetId: await asset() })).body;

  const make = async (body: Record<string, unknown>) => {
    const output = await store.upload({ data: png(), filename: "o.png", ownerId: alice.id });
    return (await call<Meme>("POST", "/api/memes", alice, { outputAssetId: output.id, layers: [], post: true, ...body })).body;
  };
  const fromScene = await make({ templateId: variation.id });
  const teamMeme = await make({ templateId: plain.id, tags: ["google-memes"] });
  await make({ templateId: variation.id, visibility: "private" });
  assert.deepEqual(fromScene.tags, []);
  assert.deepEqual(teamMeme.tags, ["google-memes"]);

  const galleryIds = async (tag: string) =>
    (await call<Page<Meme>>("GET", `/api/gallery?period=all&tag=${tag}`, null)).body.items.map((m) => m.id);
  assert.deepEqual(await galleryIds("movie"), [fromScene.id]);
  assert.deepEqual(await galleryIds("google-memes"), [teamMeme.id]);

  const templates = await call<Page<Template>>("GET", "/api/templates?tag=movie", null);
  assert.deepEqual(templates.body.items.map((t) => t.name), ["Base"]);

  const movie = (await call<Tag>("GET", "/api/tags/movie", null)).body;
  assert.deepEqual([movie.templateCount, movie.memeCount], [1, 1]);
  const teamTags = await call<Tag[]>("GET", "/api/tags?kind=team", null);
  assert.deepEqual(teamTags.body.map((t) => t.slug), ["google-memes"]);

  // Retagging: owner yes, others no; ownerless (seeded) templates are community-tagged.
  assert.equal((await call("PUT", `/api/templates/${plain.id}/tags`, bob, { tags: ["x"] })).status, 403);
  await sql`update templates set owner_id = null where id = ${plain.id}`;
  const retagged = await call<Template>("PUT", `/api/templates/${plain.id}/tags`, bob, { tags: ["oldschool"] });
  assert.deepEqual(retagged.body.tags, ["oldschool"]);
  assert.equal((await call("PUT", `/api/templates/${plain.id}/tags`, bob, { tags: ["!!!"] })).status, 400);
});
