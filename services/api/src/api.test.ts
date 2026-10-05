import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import {
  DEFAULT_LIMITS,
  newTextLayer,
  type Comment,
  type HotTemplate,
  type LeaderboardEntry,
  type Meme,
  type Page,
  type Template,
  type Tag,
  type TemplateUsage,
  type User,
  type UserProfile,
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
  await sql`truncate users, assets cascade`;
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

/** A fresh image uploaded by `owner`; returns its asset id. */
async function upload(owner: User, filename = "t.png"): Promise<string> {
  return (await store.upload({ data: png(), filename, ownerId: owner.id })).id;
}

/** A template (public unless `isPublic: false`) from a fresh image, owned by `owner`. */
async function makeTemplate(
  owner: User,
  { name = "Base", ...rest }: { name?: string; parentId?: string; isPublic?: boolean; tags?: string[] } = {},
): Promise<Template> {
  const res = await call<Template>("POST", "/api/templates", owner, { name, assetId: await upload(owner), ...rest });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

/** A meme by `owner` (posted and public by default), from `templateId` or else a new template of theirs. */
async function makeMeme(
  owner: User,
  opts: { templateId?: string; post?: boolean; visibility?: "public" | "private"; tags?: string[] } = {},
): Promise<Meme> {
  const res = await call<Meme>("POST", "/api/memes", owner, {
    templateId: opts.templateId ?? (await makeTemplate(owner)).id,
    outputAssetId: await upload(owner, "o.png"),
    layers: [newTextLayer()],
    visibility: opts.visibility ?? "public",
    post: opts.post ?? true,
    tags: opts.tags,
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

test("the reserved memegen account can't sign in and authors templates inserted without an owner", async () => {
  assert.equal((await call("POST", "/api/session", null, { username: "MemeGen" })).status, 400);
  const alice = await signIn("alice");
  const [row] = await sql<{ id: string }[]>`
    insert into templates (name, asset_id, owner_id) values ('Builtin', ${await upload(alice)}, null) returning id`;
  const builtin = await call<Template>("GET", `/api/templates/${row!.id}`, null);
  assert.equal(builtin.body.owner.username, "memegen");
  assert.equal((await call("PATCH", `/api/templates/${row!.id}`, alice, { name: "Mine" })).status, 403);
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

test("profiles count the public templates a user added, variations included", async () => {
  const alice = await signIn("alice");
  const base = await makeTemplate(alice);
  await makeTemplate(alice, { name: "Tweak", parentId: base.id });
  await makeTemplate(alice, { name: "Hidden", isPublic: false });
  await signIn("bob");

  const count = async (path: string, viewer: User | null) =>
    (await call<UserProfile>("GET", path, viewer)).body.templateCount;
  assert.equal(await count("/api/users/alice", null), 2);
  assert.equal(await count("/api/me", alice), 2);
  assert.equal(await count("/api/users/bob", null), 0);
});

test("a user's templates: variations included, newest first; private ones only for their owner", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const base = await makeTemplate(alice);
  const tweak = await makeTemplate(alice, { name: "Tweak", parentId: base.id });
  const hidden = await makeTemplate(alice, { name: "Hidden", isPublic: false });
  await makeTemplate(bob, { name: "Not hers" });

  const names = async (viewer: User | null) =>
    (await call<Page<Template>>("GET", "/api/users/alice/templates", viewer)).body.items.map((t) => t.name);
  assert.deepEqual(await names(alice), [hidden.name, tweak.name, base.name]);
  assert.deepEqual(await names(bob), [tweak.name, base.name]);
  assert.deepEqual(await names(null), [tweak.name, base.name]);
  assert.equal((await call("GET", "/api/users/nobody/templates", null)).status, 404);
});

test("leaderboard: posters only, ordered by the chosen stat with tie-breaks, public stats only", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const carol = await signIn("carol");
  const dave = await signIn("dave");
  for (const score of [3, 3, 1, -1]) await setScore((await makeMeme(alice)).id, score);
  await setScore((await makeMeme(bob)).id, 10);
  for (const score of [2, 2, 0, 0, -3]) await setScore((await makeMeme(carol)).id, score);
  await setScore((await makeMeme(dave, { post: false })).id, 50); // drafts only: not on the board

  const board = async (by: string) => (await call<LeaderboardEntry[]>("GET", `/api/leaderboard?by=${by}`, null)).body;
  // hScore: alice and carol tie at 2; alice's higher high score breaks it.
  const byH = await board("hScore");
  assert.deepEqual(
    byH.map((e) => [e.rank, e.user.username, e.stats]),
    [
      [1, "alice", { memeCount: 4, highScore: 3, hScore: 2 }],
      [2, "carol", { memeCount: 5, highScore: 2, hScore: 2 }],
      [3, "bob", { memeCount: 1, highScore: 10, hScore: 1 }],
    ],
  );
  assert.equal(byH.some((e) => "negativeHScore" in e.stats), false);
  assert.deepEqual((await board("highScore")).map((e) => e.user.username), ["bob", "alice", "carol"]);
  assert.deepEqual((await board("memeCount")).map((e) => e.user.username), ["carol", "alice", "bob"]);
  assert.deepEqual((await board("hScore&limit=1")).map((e) => e.user.username), ["alice"]);
});

test("templates allow exactly one level of variations", async () => {
  const alice = await signIn("alice");
  const parent = await makeTemplate(alice);
  const variation = await makeTemplate(alice, { name: "Tweak", parentId: parent.id });
  const nested = await call("POST", "/api/templates", alice, {
    name: "Nested",
    assetId: await upload(alice),
    parentId: variation.id,
  });
  assert.equal(nested.status, 400);

  const list = await call<Page<Template>>("GET", "/api/templates", null);
  assert.deepEqual(list.body.items.map((t) => [t.name, t.variations.map((v) => v.name)]), [["Base", ["Tweak"]]]);

  // The DB trigger also guards direct writes: a parent with variations can't become a variation.
  const other = await makeTemplate(alice, { name: "Other" });
  await assert.rejects(sql`update templates set parent_id = ${other.id} where id = ${parent.id}`, /has variations/);
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

test("recent activity: liked and disliked memes together, newest vote first, only memes still visible", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const older = await makeMeme(alice);
  const newer = await makeMeme(alice);
  const hidden = await makeMeme(alice);
  const disliked = await makeMeme(alice);
  const own = await makeMeme(bob);
  await makeMeme(alice); // never voted on: not activity
  const vote = (memeId: string, value: number) => call("PUT", `/api/memes/${memeId}/vote`, bob, { value });
  for (const m of [older, newer, hidden, own]) await vote(m.id, 1);
  await vote(disliked.id, -1);
  for (const [memeId, hours] of [[older.id, 4], [disliked.id, 3], [own.id, 2], [newer.id, 1]] as const) {
    await sql`update votes set created_at = now() - ${hours + " hours"}::interval where meme_id = ${memeId}`;
  }
  await call("PATCH", `/api/memes/${hidden.id}`, alice, { visibility: "private" });

  const activity = (await call<Page<Meme>>("GET", "/api/me/activity", bob)).body.items;
  assert.deepEqual(
    activity.map((m) => [m.id, m.myVote]),
    [
      [newer.id, 1],
      [own.id, 1],
      [disliked.id, -1],
      [older.id, 1],
    ],
  );
  assert.equal((await call("GET", "/api/me/activity", null)).status, 401);
});

test("favorites: star and unstar posted public memes; newest first; separate from votes", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const first = await makeMeme(alice);
  const second = await makeMeme(alice);
  const draft = await makeMeme(alice, { post: false });
  const star = (memeId: string, favorite: boolean) => call<Meme>("PUT", `/api/memes/${memeId}/favorite`, bob, { favorite });

  const starred = await star(first.id, true);
  assert.deepEqual([starred.status, starred.body.favorited, starred.body.myVote], [200, true, 0]);
  assert.equal((await star(first.id, true)).status, 200); // idempotent
  await star(second.id, true);
  await sql`update favorites set created_at = now() - interval '1 hour' where meme_id = ${first.id}`;
  assert.equal((await call("PUT", `/api/memes/${draft.id}/favorite`, alice, { favorite: true })).status, 400);

  const favorites = async () => (await call<Page<Meme>>("GET", "/api/me/favorites", bob)).body.items.map((m) => m.id);
  assert.deepEqual(await favorites(), [second.id, first.id]);
  assert.equal((await call<Meme>("GET", `/api/memes/${first.id}`, alice)).body.favorited, false); // per viewer

  await star(second.id, false);
  assert.deepEqual(await favorites(), [first.id]);
  assert.equal((await call("GET", "/api/me/favorites", null)).status, 401);
  assert.equal((await call("PUT", `/api/memes/${first.id}/favorite`, null, { favorite: true })).status, 401);
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

test("memes need an existing template and an output uploaded by the author", async () => {
  const alice = await signIn("alice");
  const eve = await signIn("eve");
  const template = await makeTemplate(alice);
  const aliceOutput = await upload(alice, "o.png");
  const eveOutput = await upload(eve, "o.png");
  const create = (body: Record<string, unknown>) => call("POST", "/api/memes", eve, { layers: [], ...body });
  assert.equal((await create({ templateId: template.id, outputAssetId: aliceOutput })).status, 403);
  assert.equal((await create({ outputAssetId: eveOutput })).status, 400); // no template
  assert.equal((await create({ sourceAssetId: eveOutput, outputAssetId: eveOutput })).status, 400);
  assert.equal((await create({ templateId: crypto.randomUUID(), outputAssetId: eveOutput })).status, 404);
  const made = await create({ templateId: template.id, outputAssetId: eveOutput });
  assert.equal(made.status, 201);

  // A template in use can't be deleted (nor can its parent, which would take the variation with it).
  assert.equal((await call("DELETE", `/api/templates/${template.id}`, alice)).status, 409);
  const unused = await makeTemplate(alice, { name: "Unused" });
  assert.equal((await call("DELETE", `/api/templates/${unused.id}`, alice)).status, 204);
});

test("template usage: variations roll up to the parent, history survives deletion, windows apply", async () => {
  const alice = await signIn("alice");
  const base = await makeTemplate(alice);
  const tweak = await makeTemplate(alice, { name: "Tweak", parentId: base.id });
  const cold = await makeTemplate(alice, { name: "Cold" });

  await makeMeme(alice, { templateId: base.id });
  const fromVariation = await makeMeme(alice, { templateId: tweak.id, post: false });
  await makeMeme(alice, { templateId: tweak.id, post: false });
  const old = await makeMeme(alice, { templateId: cold.id });
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
  const team = await call<Tag>("POST", "/api/tags", alice, { name: "Google Memes!", kind: "team" });
  assert.deepEqual([team.status, team.body.slug, team.body.kind], [201, "google-memes", "team"]);
  assert.equal((await call("POST", "/api/tags", alice, { name: "google memes" })).status, 409);

  const base = await makeTemplate(alice);
  const variation = await makeTemplate(alice, { name: "Scene", parentId: base.id, tags: ["Movie", "movie", "Brand New"] });
  assert.deepEqual(variation.tags, ["brand-new", "movie"]);
  const plain = await makeTemplate(alice, { name: "Plain" });

  const fromScene = await makeMeme(alice, { templateId: variation.id });
  const teamMeme = await makeMeme(alice, { templateId: plain.id, tags: ["google-memes"] });
  await makeMeme(alice, { templateId: variation.id, visibility: "private" });
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

  // Creation tags are base tags; anyone signed in adds more on top, and base tags stay base.
  assert.deepEqual([variation.baseTags, plain.baseTags], [["brand-new", "movie"], []]);
  const added = await call<Template>("POST", `/api/templates/${variation.id}/tags`, bob, { tags: ["Oldschool", "movie"] });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.tags, ["brand-new", "movie", "oldschool"]);
  assert.deepEqual(added.body.baseTags, ["brand-new", "movie"]);
  const again = (await call<Template>("GET", `/api/templates/${variation.id}`, null)).body;
  assert.deepEqual([again.tags, again.baseTags], [added.body.tags, added.body.baseTags]);
  assert.equal((await call("POST", `/api/templates/${plain.id}/tags`, bob, { tags: ["!!!"] })).status, 400);
  assert.equal((await call("POST", `/api/templates/${plain.id}/tags`, null, { tags: ["x"] })).status, 401);
});

test("comments: one level of replies on posted public memes, author-only delete with placeholders", async () => {
  const alice = await signIn("alice");
  const bob = await signIn("bob");
  const meme = await makeMeme(alice);
  const post = (u: User | null, body: Record<string, unknown>, memeId = meme.id) =>
    call<Comment>("POST", `/api/memes/${memeId}/comments`, u, body);

  const top = await post(bob, { body: "  first!  " });
  assert.equal(top.status, 201);
  assert.deepEqual(
    [top.body.body, top.body.parentId, top.body.author.username, top.body.deleted],
    ["first!", null, "bob", false],
  );
  const reply = await post(alice, { body: "thanks", parentId: top.body.id });
  assert.deepEqual([reply.status, reply.body.parentId], [201, top.body.id]);
  assert.equal((await post(bob, { body: "nested", parentId: reply.body.id })).status, 400);
  const elsewhere = (await post(bob, { body: "elsewhere" }, (await makeMeme(alice)).id)).body;
  assert.equal((await post(bob, { body: "cross-meme", parentId: elsewhere.id })).status, 400);
  assert.equal((await post(bob, { body: "early" }, (await makeMeme(alice, { post: false })).id)).status, 400);
  assert.equal((await post(null, { body: "anon" })).status, 401);
  const second = (await post(alice, { body: "second" })).body;

  const list = async () => (await call<Page<Comment>>("GET", `/api/memes/${meme.id}/comments`, null)).body.items;
  const commentCount = async () => (await call<Meme>("GET", `/api/memes/${meme.id}`, null)).body.commentCount;
  assert.deepEqual(
    (await list()).map((c) => [c.body, c.replies.map((r) => r.body)]),
    [["first!", ["thanks"]], ["second", []]],
  );
  assert.equal(await commentCount(), 3);

  assert.equal((await call("DELETE", `/api/comments/${top.body.id}`, alice)).status, 403);
  // It has a reply, so it stays as a placeholder.
  assert.equal((await call("DELETE", `/api/comments/${top.body.id}`, bob)).status, 204);
  const [placeholder] = await list();
  assert.deepEqual(
    [placeholder!.id, placeholder!.deleted, placeholder!.body, placeholder!.replies.map((r) => r.id)],
    [top.body.id, true, "", [reply.body.id]],
  );
  assert.equal(await commentCount(), 2);
  // Its last reply goes, and the placeholder goes with it.
  assert.equal((await call("DELETE", `/api/comments/${reply.body.id}`, alice)).status, 204);
  assert.deepEqual((await list()).map((c) => c.id), [second.id]);
  assert.equal(await commentCount(), 1);
  assert.equal((await call("DELETE", `/api/comments/${top.body.id}`, bob)).status, 404);
});
