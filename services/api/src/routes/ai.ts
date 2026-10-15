import { AI_KEY_HEADER, aiImageFieldsSchema, limitViolations, sniff, supportedTypesLabel, type UploadLimits } from "@memegen/shared";
import { HttpError, parse } from "@memegen/server-kit";
import { requireUser, type ApiApp } from "../access.ts";
import type { AiProviders } from "../ai/registry.ts";
import { AiProviderError } from "../ai/types.ts";

/** Multipart overhead allowance on top of the file cap for the early Content-Length check. */
const MULTIPART_SLACK = 64 * 1024;

/**
 * AI images: a prompt and a background image go to the caller's chosen provider with their own key; the result comes
 * back as image bytes. Nothing is stored: the client uploads a result it keeps, like any new template media.
 */
export function register(app: ApiApp, providers: AiProviders, limits: UploadLimits): void {
  app.post("/api/ai/images", async (c) => {
    requireUser(c);
    const apiKey = c.req.header(AI_KEY_HEADER)?.trim();
    if (!apiKey) throw new HttpError(400, "add your API key for this provider in your profile");
    if (Number(c.req.header("content-length") ?? 0) > limits.maxBytes + MULTIPART_SLACK) {
      throw new HttpError(413, "image too large", limitViolations(Number(c.req.header("content-length")), null, limits));
    }
    const body = await c.req.parseBody();
    const fields = parse(aiImageFieldsSchema, { provider: body.provider, prompt: body.prompt });
    if (!(body.image instanceof File)) throw new HttpError(400, "multipart field `image` is required");
    const data = new Uint8Array(await body.image.arrayBuffer());
    const sizeViolations = limitViolations(data.byteLength, null, limits);
    if (sizeViolations.length) throw new HttpError(413, "image too large", sizeViolations);
    const type = sniff(data);
    if (type?.kind !== "image") throw new HttpError(415, `image must be a still ${supportedTypesLabel("image")}`);

    const provider = providers[fields.provider];
    let output: Uint8Array<ArrayBuffer>;
    try {
      output = await provider.edit({
        apiKey,
        prompt: fields.prompt,
        image: { data, mime: type.mime, ext: type.ext },
        signal: c.req.raw.signal,
      });
    } catch (err) {
      if (!(err instanceof AiProviderError)) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        throw new HttpError(502, `${provider.label} is unreachable`, [err instanceof Error ? err.message : String(err)]);
      }
      // Never 401: the web client reads that as our own session being rejected.
      if (err.status === 429) throw new HttpError(429, `${provider.label}: ${err.message}`);
      if (err.status >= 400 && err.status < 500) throw new HttpError(422, `${provider.label}: ${err.message}`);
      throw new HttpError(502, `${provider.label}: ${err.message}`);
    }
    const outType = sniff(output);
    if (outType?.kind !== "image") throw new HttpError(502, `${provider.label} returned an unsupported file`);
    return c.body(output, 200, { "content-type": outType.mime, "cache-control": "no-store" });
  });
}
