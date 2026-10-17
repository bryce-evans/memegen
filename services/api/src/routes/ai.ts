import {
  AI_KEY_HEADER,
  aiEditFieldsSchema,
  aiImageFieldsSchema,
  limitViolations,
  sniff,
  supportedTypesLabel,
  type AiEdit,
  type UploadLimits,
} from "@memegen/shared";
import { HttpError, parse, type Env } from "@memegen/server-kit";
import type { Context } from "hono";
import { requireUser, type ApiApp } from "../access.ts";
import { normalizeEdit } from "../ai/quickEdit.ts";
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

/** A multipart text field holding JSON, parsed (absent stays undefined, for the schema to report). */
function jsonField(value: unknown, name: string): unknown {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `multipart field \`${name}\` must be JSON text`);
  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(400, `multipart field \`${name}\` must be JSON text`);
  }
}

/**
 * AI images and Quick Creator edits go to the caller's chosen provider with their own key. Images: a prompt and a
 * background image in, the result's bytes out. Edits: a `quick-creator/1` request (and optionally the image) in, the
 * agent's checked edit out. Nothing is stored: the client uploads a result image it keeps, like any new template media.
 */
export function register(app: ApiApp, providers: AiProviders, limits: UploadLimits): void {
  app.post("/api/ai/images", async (c) => {
    const apiKey = preflight(c, limits);
    const body = await c.req.parseBody();
    const fields = parse(aiImageFieldsSchema, { provider: body.provider, prompt: body.prompt, model: body.model });
    if (!(body.image instanceof File)) throw new HttpError(400, "multipart field `image` is required");
    const image = await readStill(body.image, limits);

    const provider = providers[fields.provider];
    const output = await callProvider(provider, () =>
      provider.edit({ apiKey, prompt: fields.prompt, image, model: fields.model, signal: c.req.raw.signal }),
    );
    const outType = sniff(output);
    if (outType?.kind !== "image") throw new HttpError(502, `${provider.label} returned an unsupported file`);
    return c.body(output, 200, { "content-type": outType.mime, "cache-control": "no-store" });
  });

  app.post("/api/ai/edit", async (c) => {
    const apiKey = preflight(c, limits);
    const body = await c.req.parseBody();
    const fields = parse(aiEditFieldsSchema, {
      provider: body.provider,
      model: body.model,
      request: jsonField(body.request, "request"),
    });
    if (body.image !== undefined && !(body.image instanceof File)) throw new HttpError(400, "multipart field `image` must be a file");
    const image = body.image instanceof File ? await readStill(body.image, limits) : undefined;

    const provider = providers[fields.provider];
    // Multipart sends line breaks as CRLF; the model sees plain newlines.
    const request = { ...fields.request, directions: fields.request.directions.replace(/\r\n?/g, "\n") };
    const edit: AiEdit = await callProvider(provider, async () =>
      normalizeEdit(
        await provider.quickEdit({ apiKey, request, image, model: fields.model, signal: c.req.raw.signal }),
        request,
        image !== undefined,
      ),
    );
    return c.json(edit, 200, { "cache-control": "no-store" });
  });
}
