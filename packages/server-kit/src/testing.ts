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
/** A prompt or caption text containing this is refused like a content-policy rejection. */
export const AI_STUB_REFUSE = "[refuse]";

/** What an accepted image edit received: the prompt and the background image's mime and size. */
export interface AiStubImageCall {
  prompt: string;
  mime: string;
  bytes: number;
}
/** What an accepted caption placement received: the user's text, the template's boxes, and whether an image came along. */
export interface AiStubCaptionCall {
  kind: "captions";
  text: string;
  boxes: unknown[];
  hasImage: boolean;
}

export interface AiStub {
  /** `OPENAI_BASE_URL` and `GEMINI_BASE_URL` values pointing at the stub. */
  urls: { openai: string; gemini: string };
  /** What the last accepted call received. */
  last: AiStubImageCall | AiStubCaptionCall | null;
  close(): Promise<void>;
}

/**
 * The request the API's caption prompt carries as JSON after `Request (JSON):` (`captionUserPrompt` in
 * services/api), and the stub's deterministic answer: lines starting `mod:` are the image modification (joined, else
 * null); every other line is a caption, any `<position> text:` label dropped, empty ones skipped, centered and spread
 * top to bottom.
 */
function stubCaptions(prompt: string): {
  text: string;
  boxes: unknown[];
  answer: { captions: { text: string; x: number; y: number; width: number; height: number }[]; modification: string | null };
} {
  const marker = "Request (JSON):\n";
  const request = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as { text: string; boxes: unknown[] };
  const mods: string[] = [];
  const lines = request.text.split("\n").flatMap((line) => {
    const mod = /^\s*mod:(.*)$/i.exec(line);
    if (mod) {
      if (mod[1]!.trim()) mods.push(mod[1]!.trim());
      return [];
    }
    const text = line.replace(/^\s*\w+ text:/i, "").trim();
    return text ? [text] : [];
  });
  const captions = lines.map((text, i) => ({ text, x: 0.5, y: lines.length === 1 ? 0.1 : 0.1 + (0.8 * i) / (lines.length - 1), width: 0.9, height: 0.2 }));
  return { text: request.text, boxes: request.boxes, answer: { captions, modification: mods.length ? mods.join(" ") : null } };
}

/**
 * A local stand-in for the OpenAI image-edit and chat-completions endpoints and Gemini generateContent (images, and
 * JSON answers for captions), speaking each wire format: tests exercise the real adapters without keys or network.
 */
export async function startAiStub(port = 0): Promise<AiStub> {
  const result = Buffer.from(encodePng(AI_STUB_RESULT.width, AI_STUB_RESULT.height, new Uint8Array(AI_STUB_RESULT.width * AI_STUB_RESULT.height * 3).fill(200)));
  const stub: AiStub = { urls: { openai: "", gemini: "" }, last: null, close: async () => {} };
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
      const body = (await request.json()) as { messages: { role: string; content: string | { type: string; text?: string }[] }[] };
      const user = body.messages.find((m) => m.role === "user")!.content as { type: string; text?: string }[];
      const placed = stubCaptions(user.find((p) => p.type === "text")!.text!);
      if (placed.text.includes(AI_STUB_REFUSE)) return json(res, 200, { choices: [{ message: { role: "assistant", content: null, refusal: "I can't help with that." } }] });
      stub.last = { kind: "captions", text: placed.text, boxes: placed.boxes, hasImage: user.some((p) => p.type === "image_url") };
      return json(res, 200, { choices: [{ message: { role: "assistant", content: JSON.stringify(placed.answer), refusal: null } }] });
    }
    if (req.url === "/openai/v1/images/edits") {
      if (header("authorization") !== `Bearer ${AI_STUB_KEY}`) return json(res, 401, { error: { message: "Incorrect API key provided" } });
      const form = await request.formData();
      const prompt = String(form.get("prompt"));
      const image = form.get("image") as File;
      if (prompt.includes(AI_STUB_REFUSE)) return json(res, 400, { error: { message: "Your request was rejected by the safety system." } });
      stub.last = { prompt, mime: image.type, bytes: image.size };
      return json(res, 200, { data: [{ b64_json: result.toString("base64") }] });
    }
    if (/^\/gemini\/v1beta\/models\/[^/]+:generateContent$/.test(req.url ?? "")) {
      if (header("x-goog-api-key") !== AI_STUB_KEY) return json(res, 400, { error: { message: "API key not valid. Please pass a valid API key." } });
      const body = (await request.json()) as {
        contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
        generationConfig?: { responseMimeType?: string };
      };
      const parts = body.contents[0]!.parts;
      const prompt = parts.find((p) => p.text)?.text ?? "";
      if (body.generationConfig?.responseMimeType === "application/json") {
        const placed = stubCaptions(prompt);
        if (placed.text.includes(AI_STUB_REFUSE)) return json(res, 200, { promptFeedback: { blockReason: "SAFETY" } });
        stub.last = { kind: "captions", text: placed.text, boxes: placed.boxes, hasImage: parts.some((p) => p.inlineData) };
        return json(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(placed.answer) }] } }] });
      }
      const image = parts.find((p) => p.inlineData)!.inlineData!;
      if (prompt.includes(AI_STUB_REFUSE)) return json(res, 200, { candidates: [{ content: { parts: [{ text: "I can't make that image." }] } }] });
      stub.last = { prompt, mime: image.mimeType, bytes: Buffer.from(image.data, "base64").byteLength };
      return json(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: result.toString("base64") } }] } }] });
    }
    json(res, 404, { error: { message: "not found" } });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(port, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address: AddressInfo = server.address() as AddressInfo; // listen() on a port always yields an AddressInfo
  const base = `http://127.0.0.1:${address.port}`;
  stub.urls = { openai: `${base}/openai/v1`, gemini: `${base}/gemini/v1beta` };
  stub.close = () => {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    return closed.promise;
  };
  return stub;
}
