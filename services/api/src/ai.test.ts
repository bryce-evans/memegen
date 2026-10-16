import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AI_CAPTIONS_MAX, AI_KEY_HEADER, AI_PROMPT_MAX_LENGTH, AI_PROVIDER_IDS, sniff, TEXT_BOX_MIN, type AiCaptionsResponse, type User } from "@memegen/shared";
import { HeaderAuthProvider, type Sql } from "@memegen/server-kit";
import { AI_STUB_KEY, AI_STUB_REFUSE, AI_STUB_RESULT, encodePng, freshTestDb, startAiStub, type AiStub } from "@memegen/server-kit/testing";
import { createAiProviders } from "./ai/registry.ts";
import { normalizePlacement } from "./ai/captions.ts";
import { AiProviderError } from "./ai/types.ts";
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

function post(path: string, fields: Record<string, string>, { key = AI_STUB_KEY as string | null, image = background as Uint8Array<ArrayBuffer> | null, signedIn = true } = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  if (image) form.set("image", new Blob([image]), "background.png");
  const headers: Record<string, string> = {};
  if (signedIn) headers["x-user-id"] = user.id;
  if (key !== null) headers[AI_KEY_HEADER] = key;
  return app.request(path, { method: "POST", headers, body: form });
}

const generate = (fields: Record<string, string>, options?: Parameters<typeof post>[2]) => post("/api/ai/images", fields, options);
const caption = (fields: Record<string, string>, options?: Parameters<typeof post>[2]) => post("/api/ai/captions", fields, options);

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

  test(`${provider}: the model splits the description into placed captions and an image change; the template's boxes go along as hints`, async () => {
    const boxes = [{ text: "Top", x: 0.5, y: 0.1, width: 0.9, height: 0.2 }];
    stub.last = null;
    const res = await caption({ provider, text: " one does not simply \n\n walk into mordor ", boxes: JSON.stringify(boxes) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual((await res.json()) as AiCaptionsResponse, {
      captions: [
        { text: "one does not simply", x: 0.5, y: 0.1, width: 0.9, height: 0.2 },
        { text: "walk into mordor", x: 0.5, y: 0.9, width: 0.9, height: 0.2 },
      ],
      modification: null,
    });
    assert.deepEqual(stub.last, { kind: "captions", text: "one does not simply \n\n walk into mordor", boxes, hasImage: true });

    const textOnly = await caption({ provider, text: "just one line" }, { image: null });
    assert.equal(textOnly.status, 200);
    assert.deepEqual(((await textOnly.json()) as AiCaptionsResponse).captions, [{ text: "just one line", x: 0.5, y: 0.1, width: 0.9, height: 0.2 }]);
    assert.deepEqual(stub.last, { kind: "captions", text: "just one line", boxes: [], hasImage: false });

    // A change to the picture comes back separately, and alone it needs no captions.
    const withMod = await caption({ provider, text: "top text: hello\nmod: add a party hat" });
    assert.deepEqual((await withMod.json()) as AiCaptionsResponse, {
      captions: [{ text: "hello", x: 0.5, y: 0.1, width: 0.9, height: 0.2 }],
      modification: "add a party hat",
    });
    const modOnly = await caption({ provider, text: "mod: add a party hat" });
    assert.deepEqual((await modOnly.json()) as AiCaptionsResponse, { captions: [], modification: "add a party hat" });
  });

  test(`${provider}: a rejected key or a refused caption is a 422, never a 401`, async () => {
    const badKey = await caption({ provider, text: "hello" }, { key: "wrong" });
    assert.equal(badKey.status, 422);
    assert.match(await errorOf(badKey), /API key/);
    const refused = await caption({ provider, text: `hello ${AI_STUB_REFUSE}` });
    assert.equal(refused.status, 422);
    assert.match(await errorOf(refused), /can't help|blocked/);
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

test("AI captions need a signed-in user, a key, text, JSON boxes, and a still image if any", async () => {
  const ok = { provider: "gemini", text: "hello" };
  assert.equal((await caption(ok, { signedIn: false })).status, 401);
  assert.equal((await caption(ok, { key: null })).status, 400);
  assert.equal((await caption({ provider: "gemini", text: "  " })).status, 400);
  assert.equal((await caption({ ...ok, boxes: "[{" })).status, 400);
  assert.equal((await caption({ ...ok, boxes: JSON.stringify([{ text: "", x: 2, y: 0, width: 1, height: 1 }]) })).status, 400);
  assert.equal((await caption(ok, { image: GIF })).status, 415);
});

test("model output is clamped into the media, empty or malformed captions dropped, and capped; nothing left is a 502", () => {
  const { captions, modification } = normalizePlacement({
    captions: [
      { text: "  off the edge ", x: -0.2, y: 1.4, width: 1.5, height: 0 },
      { text: "   ", x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      { text: "no coords" },
      ...Array.from({ length: AI_CAPTIONS_MAX + 2 }, (_, i) => ({ text: `line ${i}`, x: 0.5, y: 0.5, width: 0.5, height: 0.5 })),
    ],
    modification: "   ",
  });
  assert.equal(captions.length, AI_CAPTIONS_MAX);
  assert.deepEqual(captions[0], { text: "off the edge", x: 0, y: 1, width: 1, height: TEXT_BOX_MIN });
  assert.equal(captions[1]!.text, "line 0");
  assert.equal(modification, null);
  assert.deepEqual(normalizePlacement({ captions: [], modification: ` ${"x".repeat(AI_PROMPT_MAX_LENGTH + 5)} ` }).modification, "x".repeat(AI_PROMPT_MAX_LENGTH));
  for (const output of [{ captions: [] }, { captions: [{ text: "" }], modification: " " }, "nope", null]) {
    assert.throws(() => normalizePlacement(output), (err) => err instanceof AiProviderError && err.status === 502);
  }
});
