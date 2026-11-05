import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { Hono } from "hono";
import { z } from "zod";
import { FEEDBACK_LIMITS } from "@memegen/shared";
import { HeaderAuthProvider, installAuth, installErrorHandler, type Env, type Sql } from "@memegen/server-kit";
import { encodePng, freshTestDb } from "@memegen/server-kit/testing";
import { feedbackConfigFromEnv } from "@memegen/server-kit/feedback-config";
import { createFeedbackConnector } from "./feedback.ts";
import { register } from "./routes/feedback.ts";

let sql: Sql;
let app: Hono<Env>;
let userId: string;
let templateId: string;
let memeId: string;
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.WEB_PORT || 5173}`;
const deliverySchema = z.object({
  user: z.object({ id: z.uuid(), username: z.string() }),
  screenshots: z.array(z.object({ name: z.string(), contentType: z.string(), base64: z.string() })),
}).passthrough();
const received: z.output<typeof deliverySchema>[] = [];
let providerStatus = 200;
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  received.push(deliverySchema.parse(JSON.parse(Buffer.concat(chunks).toString())));
  response.writeHead(providerStatus, { "content-type": "application/json" }).end(JSON.stringify(providerStatus === 200 ? { delivered: true } : { error: "private secret" }));
});
const png = Buffer.from(encodePng(1, 1));

before(async () => {
  sql = await freshTestDb();
  const [user] = await sql<{ id: string }[]>`insert into users (username) values ('feedback-reporter') returning id`;
  userId = user!.id;
  const [owner] = await sql<{ id: string }[]>`insert into users (username) values ('feedback-owner') returning id`;
  const [asset] = await sql<{ id: string }[]>`insert into assets (kind, mime, name, filename, size_bytes, sha256, provider, storage_key, owner_id)
    values ('image', 'image/png', 'test', 'test.png', 1, 'feedback', 'local', 'feedback.png', ${owner!.id}) returning id`;
  const [template] = await sql<{ id: string }[]>`insert into templates (name, owner_id, asset_id, is_public) values ('Unlisted feedback target', ${owner!.id}, ${asset!.id}, false) returning id`;
  templateId = template!.id;
  const [meme] = await sql<{ id: string }[]>`insert into memes (owner_id, template_id, source_asset_id, output_asset_id, visibility)
    values (${owner!.id}, ${templateId}, ${asset!.id}, ${asset!.id}, 'unlisted') returning id`;
  memeId = meme!.id;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  app = new Hono<Env>();
  installErrorHandler(app);
  installAuth(app, new HeaderAuthProvider(sql));
  register(app, sql, createFeedbackConnector(feedbackConfigFromEnv({ MODE: "dev", FEEDBACK_PROVIDER: "webhook", FEEDBACK_WEBHOOK_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/feedback` })));
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await sql?.end();
});

function form(payload: unknown = { kind: "bug", message: "Preview problem", path: "/create" }, files: Blob[] = []): FormData {
  const result = new FormData();
  result.append("payload", JSON.stringify(payload));
  for (const file of files) result.append("screenshots", file, "untrusted-name.html");
  return result;
}

async function post(body: FormData, headers: Record<string, string> = {}) {
  return app.request("/api/feedback", { method: "POST", headers: { origin, "x-user-id": userId, ...headers }, body });
}

test("configuration is public while delivery requires login and exact configured Origin", async () => {
  const config = await app.request("/api/feedback/config");
  assert.deepEqual(await config.json(), { enabled: true });
  assert.equal(config.headers.get("cache-control"), "no-store");
  const count = received.length;
  assert.equal((await app.request("/api/feedback", { method: "POST", headers: { origin }, body: form() })).status, 401);
  for (const origin of ["", "null", "https://evil.example", "http://localhost:5173.evil.example"]) {
    assert.equal((await post(form(), { origin })).status, 403);
  }
  assert.equal(received.length, count);
});

test("screenshots are sniffed from bytes, renamed safely, and delivered without public persistence", async () => {
  const response = await post(form(undefined, [new Blob([png], { type: "text/html" })]));
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { delivered: true });
  const delivered = received.at(-1)!;
  assert.equal(delivered.screenshots[0]!.contentType, "image/png");
  assert.equal(delivered.screenshots[0]!.name, "screenshot-1.png");
  assert.deepEqual(Buffer.from(delivered.screenshots[0]!.base64, "base64"), Buffer.from(png));
  assert.deepEqual(delivered.user, { id: userId, username: "feedback-reporter" });
  const [count] = await sql<{ count: number }[]>`select count(*)::int as count from assets`;
  assert.equal(count!.count, 1);
});

test("feedback rejects blank messages, unsafe paths, missing reports and arbitrary target links", async () => {
  const count = received.length;
  for (const payload of [
    { kind: "bug", message: "   ", path: "/" },
    { kind: "hug", message: "x".repeat(FEEDBACK_LIMITS.messageLength + 1), path: "/" },
    ...["https://evil.example", "//evil.example", "/?token=secret", "/#secret", "/%3Ftoken", "/\\evil.example"].map((path) => ({ kind: "suggestion", message: "hello", path })),
    { kind: "report", path: "/", target: { kind: "meme", id: memeId } },
    { kind: "report", path: "/", target: { kind: "meme", id: "https://evil.example" }, reason: "other" },
    { kind: "report", path: "/", target: { kind: "meme", id: memeId, url: "https://evil.example" }, reason: "other" },
  ]) assert.equal((await post(form(payload))).status, 400);
  assert.equal(received.length, count);
});

test("report targets must exist and retain ordinary unlisted direct-link visibility", async () => {
  for (const target of [{ kind: "meme", id: memeId }, { kind: "template", id: templateId }]) {
    const response = await post(form({ kind: "report", path: "/report", target, reason: "violence" }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(received.at(-1)!.target, target);
    assert.equal(received.at(-1)!.message, "");
  }
  const count = received.length;
  for (const kind of ["meme", "template"]) {
    assert.equal((await post(form({ kind: "report", path: "/report", target: { kind, id: "00000000-0000-4000-8000-000000000000" }, reason: "other" }))).status, 404);
  }
  assert.equal(received.length, count);
});

test("multipart caps apply to streamed bytes before parsing and screenshot caps apply independently", async () => {
  const count = received.length;
  assert.equal((await post(form(undefined, [new Blob(["<script>not an image</script>"], { type: "image/png" })]))).status, 400);
  assert.equal((await post(form(undefined, Array.from({ length: 3 }, () => new Blob([png]))))).status, 400);
  assert.equal((await post(form(undefined, [new Blob([new Uint8Array(FEEDBACK_LIMITS.screenshotBytes + 1)])]))).status, 413);
  const duplicate = form(); duplicate.append("payload", "{}");
  assert.equal((await post(duplicate)).status, 400);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(65536)); },
    cancel() { cancelled = true; },
  });
  const response = await app.request(new Request("http://localhost/api/feedback", {
    method: "POST", headers: { origin, "x-user-id": userId, "content-type": "multipart/form-data; boundary=never-parsed", "content-length": "1" },
    body, duplex: "half",
  } as RequestInit));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(received.length, count);
});

test("provider rejection never becomes delivered and disabled delivery returns unavailable", async () => {
  providerStatus = 503;
  const failed = await post(form());
  providerStatus = 200;
  assert.equal(failed.status, 502);
  const error = await failed.json() as { error: string; delivered?: boolean };
  assert.equal(error.delivered, undefined);
  assert.doesNotMatch(error.error, /private secret/);
  const disabled = new Hono<Env>();
  installErrorHandler(disabled);
  installAuth(disabled, new HeaderAuthProvider(sql));
  register(disabled, sql, createFeedbackConnector({ provider: "disabled" }));
  assert.deepEqual(await (await disabled.request("/api/feedback/config")).json(), { enabled: false });
  assert.equal((await disabled.request("/api/feedback", { method: "POST", headers: { origin, "x-user-id": userId }, body: form() })).status, 503);
});
