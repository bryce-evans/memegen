import {
  AI_KEY_HEADER,
  aiCaptionsFieldsSchema,
  aiImageFieldsSchema,
  limitViolations,
  sniff,
  supportedTypesLabel,
  type AiCaptionsResponse,
  type UploadLimits,
} from "@memegen/shared";
import { HttpError, parse, type Env } from "@memegen/server-kit";
import type { Context } from "hono";
import { requireUser, type ApiApp } from "../access.ts";
import { normalizePlacement } from "../ai/captions.ts";
import type { AiProviders } from "../ai/registry.ts";
import { AiProviderError, type AiImage, type AiProvider } from "../ai/types.ts";

/** Multipart overhead allowance on top of the file cap for the early Content-Length check. */
const MULTIPART_SLACK = 64 * 1024;

/** Signed-in caller's provider key, after rejecting a body that can't fit the byte cap. */
function preflight(c: Context<Env>, limits: UploadLimits): string {
  requireUser(c);
  const apiKey = c.req.header(AI_KEY_HEADER)?.trim();
  if (!apiKey) throw new HttpError(400, "add your API key for this provider in your profile");
  if (Number(c.req.header("content-length") ?? 0) > limits.maxBytes + MULTIPART_SLACK) {
    throw new HttpError(413, "image too large", limitViolations(Number(c.req.header("content-length")), null, limits));
  }
  return apiKey;
}

/** An uploaded file within the byte cap whose magic bytes say still image. */
async function readStill(file: File, limits: UploadLimits): Promise<AiImage> {
  const data = new Uint8Array(await file.arrayBuffer());
  const sizeViolations = limitViolations(data.byteLength, null, limits);
  if (sizeViolations.length) throw new HttpError(413, "image too large", sizeViolations);
  const type = sniff(data);
  if (type?.kind !== "image") throw new HttpError(415, `image must be a still ${supportedTypesLabel("image")}`);
  return { data, mime: type.mime, ext: type.ext };
}

/** Runs a provider call, mapping its failures. Never 401: the web client reads that as our own session being rejected. */
async function callProvider<T>(provider: AiProvider, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof AiProviderError)) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      throw new HttpError(502, `${provider.label} is unreachable`, [err instanceof Error ? err.message : String(err)]);
    }
    if (err.status === 429) throw new HttpError(429, `${provider.label}: ${err.message}`);
    if (err.status >= 400 && err.status < 500) throw new HttpError(422, `${provider.label}: ${err.message}`);
    throw new HttpError(502, `${provider.label}: ${err.message}`);
  }
}

/**
 * AI images and captions go to the caller's chosen provider with their own key. Images: a prompt and a background
 * image in, the result's bytes out. Captions: the user's text (and optionally the image) in, the model's placement
 * out. Nothing is stored: the client uploads a result image it keeps, like any new template media.
 */
export function register(app: ApiApp, providers: AiProviders, limits: UploadLimits): void {
  app.post("/api/ai/images", async (c) => {
    const apiKey = preflight(c, limits);
    const body = await c.req.parseBody();
    const fields = parse(aiImageFieldsSchema, { provider: body.provider, prompt: body.prompt });
    if (!(body.image instanceof File)) throw new HttpError(400, "multipart field `image` is required");
    const image = await readStill(body.image, limits);

    const provider = providers[fields.provider];
    const output = await callProvider(provider, () => provider.edit({ apiKey, prompt: fields.prompt, image, signal: c.req.raw.signal }));
    const outType = sniff(output);
    if (outType?.kind !== "image") throw new HttpError(502, `${provider.label} returned an unsupported file`);
    return c.body(output, 200, { "content-type": outType.mime, "cache-control": "no-store" });
  });

  app.post("/api/ai/captions", async (c) => {
    const apiKey = preflight(c, limits);
    const body = await c.req.parseBody();
    let boxes: unknown;
    if (body.boxes !== undefined) {
      if (typeof body.boxes !== "string") throw new HttpError(400, "multipart field `boxes` must be JSON text");
      try {
        boxes = JSON.parse(body.boxes);
      } catch {
        throw new HttpError(400, "multipart field `boxes` must be JSON text");
      }
    }
    const fields = parse(aiCaptionsFieldsSchema, { provider: body.provider, text: body.text, boxes });
    if (body.image !== undefined && !(body.image instanceof File)) throw new HttpError(400, "multipart field `image` must be a file");
    const image = body.image instanceof File ? await readStill(body.image, limits) : undefined;

    const provider = providers[fields.provider];
    // Multipart sends line breaks as CRLF; the model sees plain newlines, its natural split points.
    const text = fields.text.replace(/\r\n?/g, "\n");
    const response: AiCaptionsResponse = await callProvider(provider, async () =>
      normalizePlacement(await provider.caption({ apiKey, text, boxes: fields.boxes, image, signal: c.req.raw.signal })),
    );
    return c.json(response, 200, { "cache-control": "no-store" });
  });
}
