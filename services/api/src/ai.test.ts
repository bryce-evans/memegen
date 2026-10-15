import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AI_KEY_HEADER, AI_PROVIDER_IDS, sniff, type User } from "@memegen/shared";
import { HeaderAuthProvider, type Sql } from "@memegen/server-kit";
import { AI_STUB_KEY, AI_STUB_REFUSE, AI_STUB_RESULT, encodePng, freshTestDb, startAiStub, type AiStub } from "@memegen/server-kit/testing";
import { createAiProviders } from "./ai/registry.ts";
import { createApiApp, type ApiApp } from "./app.ts";

let sql: Sql;
let stub: AiStub;
let app: ApiApp;
let user: User;

before(async () => {
  sql = await freshTestDb();
  stub = await startAiStub();
  app = createApiApp(sql, new HeaderAuthProvider(sql), createAiProviders({ OPENAI_BASE_URL: stub.urls.openai, GEMINI_BASE_URL: stub.urls.gemini }));
  const res = await app.request("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice" }) });
  const session: { user: User } = await res.json();
  user = session.user;
});

after(async () => {
  await stub.close();
  await sql.end();
});

const background = new Uint8Array(encodePng(6, 4));
const GIF = new TextEncoder().encode("GIF89a\x01\x00\x01\x00\x00\x00\x00;");

function generate(fields: Record<string, string>, { key = AI_STUB_KEY as string | null, image = background as Uint8Array<ArrayBuffer> | null, signedIn = true } = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  if (image) form.set("image", new Blob([image]), "background.png");
  const headers: Record<string, string> = {};
  if (signedIn) headers["x-user-id"] = user.id;
  if (key !== null) headers[AI_KEY_HEADER] = key;
  return app.request("/api/ai/images", { method: "POST", headers, body: form });
}

async function errorOf(res: Response): Promise<string> {
  const body: unknown = await res.json();
  return body && typeof body === "object" && "error" in body ? String(body.error) : "";
}

for (const provider of AI_PROVIDER_IDS) {
  test(`${provider}: the prompt and background reach the provider; its image comes back as bytes`, async () => {
    stub.last = null;
    const res = await generate({ provider, prompt: "  add a hat  " });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const out = Buffer.from(await res.arrayBuffer());
    assert.equal(sniff(out)?.mime, "image/png");
    assert.deepEqual([out.readUInt32BE(16), out.readUInt32BE(20)], [AI_STUB_RESULT.width, AI_STUB_RESULT.height]); // IHDR
    assert.deepEqual(stub.last, { prompt: "add a hat", mime: "image/png", bytes: background.byteLength });
  });

  test(`${provider}: a rejected key or a refusal is a 422 with the provider's reason, never a 401`, async () => {
    const badKey = await generate({ provider, prompt: "hat" }, { key: "wrong" });
    assert.equal(badKey.status, 422);
    assert.match(await errorOf(badKey), /API key/);
    const refused = await generate({ provider, prompt: `hat ${AI_STUB_REFUSE}` });
    assert.equal(refused.status, 422);
    assert.match(await errorOf(refused), /safety|can't make/);
  });
}

test("AI images need a signed-in user, a key, a known provider, a prompt, and a still background", async () => {
  const ok = { provider: "openai", prompt: "hat" };
  assert.equal((await generate(ok, { signedIn: false })).status, 401);
  assert.equal((await generate(ok, { key: null })).status, 400);
  assert.equal((await generate(ok, { key: "  " })).status, 400);
  assert.equal((await generate({ provider: "dall-e", prompt: "hat" })).status, 400);
  assert.equal((await generate({ provider: "openai", prompt: "   " })).status, 400);
  assert.equal((await generate(ok, { image: null })).status, 400);
  assert.equal((await generate(ok, { image: GIF })).status, 415);
});
