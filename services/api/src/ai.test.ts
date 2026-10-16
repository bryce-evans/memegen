import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AI_KEY_HEADER, AI_PROMPT_MAX_LENGTH, AI_PROVIDER_IDS, sniff, type AiEdit, type AiEditRequest, type User } from "@memegen/shared";
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
const quickEdit = (fields: Record<string, string>, options?: Parameters<typeof post>[2]) => post("/api/ai/edit", fields, options);

const FONT = "8a6b2c1e-0f4d-4a7e-9b3c-2d1e0f4a7b9c";
/** A two-box template with no top section, as the Quick Creator sends it. */
function editRequest(directions: string, overrides: Partial<AiEditRequest> = {}): string {
  const request: AiEditRequest = {
    directions,
    boxes: [
      { id: "top", label: "Top text", text: "TOP TEXT", fontId: null, x: 0.5, y: 0.1 },
      { id: "bottom", label: "Bottom text", text: "BOTTOM TEXT", fontId: null, x: 0.5, y: 0.9 },
    ],
    topSection: null,
    fonts: [{ id: FONT, name: "Comic" }],
    ...overrides,
  };
  return JSON.stringify(request);
}

async function errorOf(res: Response): Promise<string> {
  const body: unknown = await res.json();
  return body && typeof body === "object" && "error" in body ? String(body.error) : "";
}

for (const provider of AI_PROVIDER_IDS) {
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

  test(`${provider}: the agent edits the listed boxes, fonts, and top section, and asks for an image edit, following its own instructions and model`, async () => {
    stub.last = null;
    const directions = "Top text: when the build passes\nfont: comic\ntop section: nobody:\nmod: add a party hat";
    const res = await quickEdit({ provider, instructions: " deadpan, lowercase ", model: "custom-text-1", request: editRequest(directions) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual((await res.json()) as AiEdit, {
      boxes: [
        { id: "top", text: "when the build passes", fontId: FONT },
        { id: "bottom", text: null, fontId: FONT },
      ],
      topSection: "nobody:",
      imageEdit: "add a party hat",
    });
    assert.deepEqual(stub.last, { kind: "edit", directions, boxIds: ["top", "bottom"], instructions: "deadpan, lowercase", model: "custom-text-1", hasImage: true });

    // Without the image (GIF/video templates), the agent can't change the picture.
    const textOnly = await quickEdit({ provider, request: editRequest("first try\nmod: add a party hat") }, { image: null });
    assert.deepEqual((await textOnly.json()) as AiEdit, { boxes: [{ id: "top", text: "first try", fontId: null }], topSection: null, imageEdit: null });
    const last = stub.last as AiStub["last"]; // reassigned by the request, which TS can't see
    assert.deepEqual(last?.kind === "edit" ? [last.boxIds, last.hasImage] : last, [["top", "bottom"], false]);
  });

  test(`${provider}: a rejected key or refused directions are a 422, never a 401`, async () => {
    const badKey = await quickEdit({ provider, request: editRequest("hello") }, { key: "wrong" });
    assert.equal(badKey.status, 422);
    assert.match(await errorOf(badKey), /API key/);
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

test("agent output is checked against the request: listed boxes and fonts only, no-op changes dropped, image edits only with an image", () => {
  const request = JSON.parse(editRequest("x")) as AiEditRequest;
  const edit = normalizeEdit(
    {
      boxes: [
        { id: "ghost", text: "a new box", fontId: null },
        { id: "top", text: "  ", fontId: "f00dfeed-0000-4000-8000-000000000000" },
        { id: "top", text: "second answer for the same box", fontId: null },
        { id: "bottom", text: "BOTTOM TEXT", fontId: FONT },
        "nonsense",
      ],
      topSection: "",
      imageEdit: ` ${"x".repeat(AI_PROMPT_MAX_LENGTH + 5)} `,
      x: 0.1,
    },
    request,
    true,
  );
  assert.deepEqual(edit, {
    // "" blanks a box; an unlisted font is no change; the same text again is no change.
    boxes: [
      { id: "top", text: "", fontId: null },
      { id: "bottom", text: null, fontId: FONT },
    ],
    // Removing a top section that isn't there is no change.
    topSection: null,
    imageEdit: "x".repeat(AI_PROMPT_MAX_LENGTH),
  });
  assert.equal(normalizeEdit({ topSection: "" }, { ...request, topSection: "nobody:" }, true).topSection, "");
  assert.equal(normalizeEdit({ imageEdit: "add a hat" }, request, false).imageEdit, null);
  // Nothing to change is a valid answer: the directions may match the template as it is.
  assert.deepEqual(normalizeEdit({ boxes: [] }, request, true), { boxes: [], topSection: null, imageEdit: null });
  for (const output of ["nope", null, [1]]) {
    assert.throws(() => normalizeEdit(output, request, true), (err) => err instanceof AiProviderError && err.status === 502);
  }
});
