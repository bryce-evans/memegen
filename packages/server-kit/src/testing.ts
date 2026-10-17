import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { crc32, deflateSync } from "node:zlib";
import { createSql, type Sql } from "./db.ts";
import { migrate } from "./migrate.ts";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/memegen_test";

/** Fresh schema in the test database. Test files run serially (--test-concurrency=1). */
export async function freshTestDb(): Promise<Sql> {
  const sql = createSql(TEST_DATABASE_URL);
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
  await migrate(sql);
  return sql;
}

/** Minimal 8-bit RGB PNG. `rgb` holds width*height*3 bytes, row-major; omitted means all black. */
export function encodePng(width: number, height: number, rgb?: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height); // each row: filter byte 0, then pixels
  if (rgb) for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** The one key the AI stub accepts; any other is rejected the way each provider rejects a bad key. */
export const AI_STUB_KEY = "stub-key";
/** Pixel size of the stub's result image (distinct from any fixture, so a spec can tell it came back). */
export const AI_STUB_RESULT = { width: 48, height: 32 } as const;
/** Directions or a prompt containing this are refused like a content-policy rejection. */
export const AI_STUB_REFUSE = "[refuse]";

/** What an accepted image edit received: the prompt, the model, and the background image's mime and size. */
export interface AiStubImageCall {
  kind: "image";
  prompt: string;
  model: string;
  mime: string;
  bytes: number;
}
/** What an accepted Quick Creator edit received: the directions, the box ids, the model, and whether an image came along. */
export interface AiStubEditCall {
  kind: "edit";
  directions: string;
  boxIds: string[];
  model: string;
  hasImage: boolean;
}

export interface AiStub {
  /** `OPENAI_BASE_URL`, `GEMINI_BASE_URL`, and `ANTHROPIC_BASE_URL` values pointing at the stub. */
  urls: { openai: string; gemini: string; anthropic: string };
  /** What the last accepted call received. */
  last: AiStubImageCall | AiStubEditCall | null;
  close(): Promise<void>;
}

interface StubEditRequest {
  directions: string;
  boxes: { id: string; label: string }[];
  fonts: { id: string; name: string }[];
}

/**
 * The request the API's edit prompt carries as JSON after `Request (JSON):` (`editUserPrompt` in services/api), and
 * the stub's deterministic answer to its directions, line by line: `mod: …` is the image edit (joined, else null);
 * `top section: …` the top section's text ("" removes it); `font: <name>` puts every box in that font; `<box label>:
 * …` that box's text; any other line goes to the next box not yet given text. Extra lines are dropped.
 */
function stubEdit(prompt: string): { request: StubEditRequest; answer: unknown } {
  const marker = "Request (JSON):\n";
  const request = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as StubEditRequest;
  const texts = new Map<string, string>();
  const mods: string[] = [];
  let topSection: string | null = null;
  let fontId: string | null = null;
  const free: string[] = [];
  for (const line of request.directions.split("\n")) {
    const [, label = "", rest = ""] = /^\s*([^:]+):(.*)$/.exec(line) ?? [];
    const key = label.trim().toLowerCase();
    const box = request.boxes.find((b) => b.label.toLowerCase() === key);
    if (key === "mod") mods.push(rest.trim());
    else if (key === "top section") topSection = rest.trim();
    else if (key === "font") fontId = request.fonts.find((f) => f.name.toLowerCase() === rest.trim().toLowerCase())?.id ?? null;
    else if (box) texts.set(box.id, rest.trim());
    else if (line.trim()) free.push(line.trim());
  }
  for (const box of request.boxes) if (!texts.has(box.id) && free.length) texts.set(box.id, free.shift()!);
  const boxes = request.boxes.flatMap((b) => (texts.has(b.id) || fontId ? [{ id: b.id, text: texts.get(b.id) ?? null, fontId }] : []));
  return { request, answer: { boxes, topSection, imageEdit: mods.filter(Boolean).join(" ") || null } };
}

/**
 * A local stand-in for the OpenAI image-edit and chat-completions endpoints, Gemini generateContent (images, and
 * JSON answers for Quick Creator edits), and Anthropic Messages (edits only), speaking each wire format: tests exercise
 * the real adapters without keys or network.
 */
export async function startAiStub(port = 0): Promise<AiStub> {
  const result = Buffer.from(encodePng(AI_STUB_RESULT.width, AI_STUB_RESULT.height, new Uint8Array(AI_STUB_RESULT.width * AI_STUB_RESULT.height * 3).fill(200)));
  const stub: AiStub = { urls: { openai: "", gemini: "", anthropic: "" }, last: null, close: async () => {} };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = { "content-type": req.headers["content-type"] ?? "" };
    const request = new Request(`http://stub${req.url}`, { method: req.method, headers, body: Buffer.concat(chunks) });
    const header = (name: string) => req.headers[name];
    if (req.url === "/openai/v1/chat/completions") {
      if (header("authorization") !== `Bearer ${AI_STUB_KEY}`) return json(res, 401, { error: { message: "Incorrect API key provided" } });
      const body = (await request.json()) as { model: string; messages: { role: string; content: string | { type: string; text?: string }[] }[] };
      const user = body.messages.find((m) => m.role === "user")!.content as { type: string; text?: string }[];
      const { request: edit, answer } = stubEdit(user.find((p) => p.type === "text")!.text!);
      if (edit.directions.includes(AI_STUB_REFUSE)) return json(res, 200, { choices: [{ message: { role: "assistant", content: null, refusal: "I can't help with that." } }] });
      stub.last = {
        kind: "edit",
        directions: edit.directions,
        boxIds: edit.boxes.map((b) => b.id),
        model: body.model,
        hasImage: user.some((p) => p.type === "image_url"),
      };
      return json(res, 200, { choices: [{ message: { role: "assistant", content: JSON.stringify(answer), refusal: null } }] });
    }
    if (req.url === "/anthropic/v1/messages") {
      if (header("x-api-key") !== AI_STUB_KEY) return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      const body = (await request.json()) as { model: string; messages: { role: string; content: { type: string; text?: string }[] }[] };
      const user = body.messages.find((m) => m.role === "user")!.content;
      const { request: edit, answer } = stubEdit(user.find((p) => p.type === "text")!.text!);
      if (edit.directions.includes(AI_STUB_REFUSE)) return json(res, 200, { stop_reason: "refusal", content: [{ type: "text", text: "I can't help with that." }] });
      stub.last = {
        kind: "edit",
        directions: edit.directions,
        boxIds: edit.boxes.map((b) => b.id),
        model: body.model,
        hasImage: user.some((p) => p.type === "image"),
      };
      return json(res, 200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }] });
    }
    if (req.url === "/openai/v1/images/edits") {
      if (header("authorization") !== `Bearer ${AI_STUB_KEY}`) return json(res, 401, { error: { message: "Incorrect API key provided" } });
      const form = await request.formData();
      const prompt = String(form.get("prompt"));
      const image = form.get("image") as File;
      if (prompt.includes(AI_STUB_REFUSE)) return json(res, 400, { error: { message: "Your request was rejected by the safety system." } });
      stub.last = { kind: "image", prompt, model: String(form.get("model")), mime: image.type, bytes: image.size };
      return json(res, 200, { data: [{ b64_json: result.toString("base64") }] });
    }
    const gemini = /^\/gemini\/v1beta\/models\/([^/]+):generateContent$/.exec(req.url ?? "");
    if (gemini) {
      if (header("x-goog-api-key") !== AI_STUB_KEY) return json(res, 400, { error: { message: "API key not valid. Please pass a valid API key." } });
      const body = (await request.json()) as {
        systemInstruction?: { parts: { text: string }[] };
        contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
        generationConfig?: { responseMimeType?: string };
      };
      const model = decodeURIComponent(gemini[1]!);
      const parts = body.contents[0]!.parts;
      const prompt = parts.find((p) => p.text)?.text ?? "";
      if (body.generationConfig?.responseMimeType === "application/json") {
        const { request: edit, answer } = stubEdit(prompt);
        if (edit.directions.includes(AI_STUB_REFUSE)) return json(res, 200, { promptFeedback: { blockReason: "SAFETY" } });
        stub.last = {
          kind: "edit",
          directions: edit.directions,
          boxIds: edit.boxes.map((b) => b.id),
          model,
          hasImage: parts.some((p) => p.inlineData),
        };
        return json(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
      }
      const image = parts.find((p) => p.inlineData)!.inlineData!;
      if (prompt.includes(AI_STUB_REFUSE)) return json(res, 200, { candidates: [{ content: { parts: [{ text: "I can't make that image." }] } }] });
      stub.last = { kind: "image", prompt, model, mime: image.mimeType, bytes: Buffer.from(image.data, "base64").byteLength };
      return json(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: result.toString("base64") } }] } }] });
    }
    json(res, 404, { error: { message: "not found" } });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(port, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address: AddressInfo = server.address() as AddressInfo; // listen() on a port always yields an AddressInfo
  const base = `http://127.0.0.1:${address.port}`;
  stub.urls = { openai: `${base}/openai/v1`, gemini: `${base}/gemini/v1beta`, anthropic: `${base}/anthropic/v1` };
  stub.close = () => {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    return closed.promise;
  };
  return stub;
}
