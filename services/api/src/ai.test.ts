import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AI_IMAGE_PROVIDER_IDS, AI_KEY_HEADER, AI_PROMPT_MAX_LENGTH, AI_PROVIDER_IDS, sniff, type AiEdit, type AiEditRequest, type User } from "@memegen/shared";
import { HeaderAuthProvider, type Sql } from "@memegen/server-kit";
import { AI_STUB_KEY, AI_STUB_REFUSE, AI_STUB_RESULT, encodePng, freshTestDb, startAiStub, type AiStub } from "@memegen/server-kit/testing";
import { createAiProviders } from "./ai/registry.ts";
import { normalizeEdit } from "./ai/quickEdit.ts";
import { AiProviderError } from "./ai/types.ts";
import { createApiApp, type ApiApp } from "./app.ts";

let sql: Sql;
let stub: AiStub;
let app: ApiApp;
let user: User;

before(async () => {
  sql = await freshTestDb();
  stub = await startAiStub();
  app = createApiApp(
    sql,
    new HeaderAuthProvider(sql),
    createAiProviders({ OPENAI_BASE_URL: stub.urls.openai, GEMINI_BASE_URL: stub.urls.gemini, ANTHROPIC_BASE_URL: stub.urls.anthropic }),
  );
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
const quickEdit = (fields: Record<string, string>, options?: Parameters<typeof post>[2]) => post("/api/ai/edit", fields, options);

const FONT = "8a6b2c1e-0f4d-4a7e-9b3c-2d1e0f4a7b9c";
/** A two-box template, as the Quick Creator sends it with an Image Generator set. */
function editRequest(directions: string, overrides: Partial<AiEditRequest> = {}): string {
  const request: AiEditRequest = {
    directions,
    boxes: [
      { id: "top", label: "Top text", text: "TOP TEXT", fontId: null, x: 0.5, y: 0.1 },
      { id: "bottom", label: "Bottom text", text: "BOTTOM TEXT", fontId: null, x: 0.5, y: 0.9 },
    ],
    fonts: [{ id: FONT, name: "Comic" }],
    canUpdateImage: true,
    ...overrides,
  };
  return JSON.stringify(request);
}

async function errorOf(res: Response): Promise<string> {
  const body: unknown = await res.json();
  return body && typeof body === "object" && "error" in body ? String(body.error) : "";
}

for (const provider of AI_IMAGE_PROVIDER_IDS) {
  test(`${provider}: the prompt, the agent's image model, and the background reach the provider; its image comes back as bytes`, async () => {
    stub.last = null;
    const res = await generate({ provider, prompt: "  add a hat  ", model: "custom-image-1" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const out = Buffer.from(await res.arrayBuffer());
    assert.equal(sniff(out)?.mime, "image/png");
    assert.deepEqual([out.readUInt32BE(16), out.readUInt32BE(20)], [AI_STUB_RESULT.width, AI_STUB_RESULT.height]); // IHDR
    assert.deepEqual(stub.last, { kind: "image", prompt: "add a hat", model: "custom-image-1", mime: "image/png", bytes: background.byteLength });
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

for (const provider of AI_PROVIDER_IDS) {
  test(`${provider}: the agent's UPDATE_IMAGE and ADD_TEXTs come back checked, on the chosen model; UPDATE_IMAGE needs the image and an Image Generator`, async () => {
    stub.last = null;
    const directions = "Bottom text: first try\nwhen the build passes\nfont: comic\nmod: add a party hat";
    const res = await quickEdit({ provider, model: "custom-text-1", request: editRequest(directions) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    // The unpositioned line takes the first box not yet given text.
    assert.deepEqual((await res.json()) as AiEdit, {
      actions: [
        { action: "UPDATE_IMAGE", prompt: "add a party hat" },
        { action: "ADD_TEXT", text: "first try", position: "bottom", style: { fontId: FONT } },
        { action: "ADD_TEXT", text: "when the build passes", position: "top", style: { fontId: FONT } },
      ],
    });
    assert.deepEqual(stub.last, { kind: "edit", directions, boxIds: ["top", "bottom"], canUpdateImage: true, model: "custom-text-1", hasImage: true });

    // Without the image (GIF/video templates) or without an Image Generator, the picture can't change: the prompt says
    // so, and an UPDATE_IMAGE sent anyway is dropped.
    for (const [request, image] of [
      [editRequest("first try\nmod: add a party hat"), null],
      [editRequest("first try\nmod: add a party hat", { canUpdateImage: false }), background],
    ] as const) {
      const textOnly = await quickEdit({ provider, request }, { image });
      assert.deepEqual((await textOnly.json()) as AiEdit, { actions: [{ action: "ADD_TEXT", text: "first try", position: "top", style: null }] });
      const last = stub.last as AiStub["last"]; // reassigned by the request, which TS can't see
      assert.deepEqual(last?.kind === "edit" ? [last.canUpdateImage, last.hasImage] : last, [false, image !== null]);
    }
  });

  test(`${provider}: a rejected key or refused directions are a 422, never a 401`, async () => {
    const badKey = await quickEdit({ provider, request: editRequest("hello") }, { key: "wrong" });
    assert.equal(badKey.status, 422);
    assert.match(await errorOf(badKey), /API key|x-api-key/);
    const refused = await quickEdit({ provider, request: editRequest(`hello ${AI_STUB_REFUSE}`) });
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
  // Text-only providers can't generate images.
  assert.equal((await generate({ provider: "anthropic", prompt: "hat" })).status, 400);
  assert.equal((await generate({ provider: "openai", prompt: "   " })).status, 400);
  assert.equal((await generate(ok, { image: null })).status, 400);
  assert.equal((await generate(ok, { image: GIF })).status, 415);
});

test("AI edits need a signed-in user, a key, a JSON request with directions, valid boxes and model, and a still image if any", async () => {
  const ok = { provider: "gemini", request: editRequest("hello") };
  assert.equal((await quickEdit(ok, { signedIn: false })).status, 401);
  assert.equal((await quickEdit(ok, { key: null })).status, 400);
  assert.equal((await quickEdit({ provider: "gemini" })).status, 400);
  assert.equal((await quickEdit({ ...ok, request: "{" })).status, 400);
  assert.equal((await quickEdit({ ...ok, request: editRequest("  ") })).status, 400);
  assert.equal((await quickEdit({ ...ok, request: editRequest("hi", { fonts: [{ id: "not-a-uuid", name: "x" }] }) })).status, 400);
  assert.equal((await quickEdit({ ...ok, model: "../../admin" })).status, 400);
  assert.equal((await generate({ provider: "openai", prompt: "hat", model: "a b" })).status, 400);
  assert.equal((await quickEdit(ok, { image: GIF })).status, 415);
});

test("agent output is checked against the request: one UPDATE_IMAGE first, ADD_TEXTs on distinct listed boxes with listed fonts, no-ops dropped", () => {
  const request = JSON.parse(editRequest("x")) as AiEditRequest;
  const edit = normalizeEdit(
    {
      actions: [
        { action: "ADD_TEXT", text: "a new box", position: "ghost", style: null },
        { action: "ADD_TEXT", text: "  ", position: "top", style: { fontId: "f00dfeed-0000-4000-8000-000000000000" } },
        { action: "ADD_TEXT", text: "second answer for the same box", position: "top", style: null },
        { action: "UPDATE_IMAGE", prompt: "   " },
        { action: "UPDATE_IMAGE", prompt: ` ${"x".repeat(AI_PROMPT_MAX_LENGTH + 5)} ` },
        { action: "UPDATE_IMAGE", prompt: "a second image update" },
        { action: "ADD_TEXT", text: "BOTTOM TEXT", position: null, style: { fontId: FONT } },
        { action: "ADD_TEXT", text: "a third box", position: null, style: null },
        { action: "ADD_TEXT", position: "bottom" },
        { action: "MOVE_TEXT", position: "top" },
        "nonsense",
      ],
      x: 0.1,
    },
    request,
    true,
  );
  assert.deepEqual(edit, {
    actions: [
      // The first non-blank UPDATE_IMAGE, capped like a prompt, moved first.
      { action: "UPDATE_IMAGE", prompt: "x".repeat(AI_PROMPT_MAX_LENGTH) },
      // "" blanks a box; an unlisted font is no change.
      { action: "ADD_TEXT", text: "", position: "top", style: null },
      // No position: the next box not yet given text. The same text in a new font is a change.
      { action: "ADD_TEXT", text: "BOTTOM TEXT", position: "bottom", style: { fontId: FONT } },
    ],
  });
  // The same text and font again is no change, but still fills its box.
  assert.deepEqual(
    normalizeEdit({ actions: [{ action: "ADD_TEXT", text: "TOP TEXT", position: null, style: null }, { action: "ADD_TEXT", text: "b", position: null, style: null }] }, request, true),
    { actions: [{ action: "ADD_TEXT", text: "b", position: "bottom", style: null }] },
  );
  const update = { actions: [{ action: "UPDATE_IMAGE", prompt: "add a hat" }] };
  assert.deepEqual(normalizeEdit(update, request, false), { actions: [] });
  assert.deepEqual(normalizeEdit(update, { ...request, canUpdateImage: false }, true), { actions: [] });
  // No actions is a valid answer: the directions may match the template as it is.
  assert.deepEqual(normalizeEdit({ actions: [] }, request, true), { actions: [] });
  for (const output of ["nope", null, [1]]) {
    assert.throws(() => normalizeEdit(output, request, true), (err) => err instanceof AiProviderError && err.status === 502);
  }
});
