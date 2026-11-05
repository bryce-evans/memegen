import { FEEDBACK_LIMITS, feedbackPayloadSchema, sniff, type FeedbackConfig } from "@memegen/shared";
import { HttpError, parse, type Sql } from "@memegen/server-kit";
import { portFromEnv } from "@memegen/server-kit/ports";
import { loadMeme, loadTemplate, requireUser, type ApiApp } from "../access.ts";
import type { FeedbackConnector, FeedbackScreenshot } from "../feedback.ts";

/** Auth and exact configured-Origin checks run before any multipart bytes are parsed. */
export function register(app: ApiApp, sql: Sql, connector: FeedbackConnector): void {
  const origin = new URL(process.env.PUBLIC_ORIGIN || `http://localhost:${portFromEnv(process.env, "WEB_PORT", 5173)}`).origin;
  app.get("/api/feedback/config", (c) => {
    c.header("cache-control", "no-store");
    return c.json({ enabled: connector.enabled } satisfies FeedbackConfig);
  });
  app.post("/api/feedback", async (c) => {
    const user = requireUser(c);
    if (c.req.header("origin") !== origin) throw new HttpError(403, "same-origin request required");
    if (!connector.enabled) throw new HttpError(503, "Feedback delivery is not configured");
    const contentType = c.req.header("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new HttpError(400, "body must be multipart form data");
    const declared = c.req.header("content-length");
    if (declared && Number(declared) > FEEDBACK_LIMITS.requestBytes) throw new HttpError(413, "feedback request is too large");
    const reader = c.req.raw.body?.getReader();
    if (!reader) throw new HttpError(400, "feedback body is required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > FEEDBACK_LIMITS.requestBytes) {
          await reader.cancel();
          throw new HttpError(413, "feedback request is too large");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks, size), { headers: { "content-type": contentType } }).formData();
    } catch { throw new HttpError(400, "invalid multipart form data"); }
    if ([...form.keys()].some((key) => key !== "payload" && key !== "screenshots")) throw new HttpError(400, "unknown feedback field");
    const payloads = form.getAll("payload");
    if (payloads.length !== 1 || typeof payloads[0] !== "string") throw new HttpError(400, "one JSON payload is required");
    let json: unknown;
    try { json = JSON.parse(payloads[0]); } catch { throw new HttpError(400, "payload must be JSON"); }
    const payload = parse(feedbackPayloadSchema, json);
    const files = form.getAll("screenshots");
    if (files.length > FEEDBACK_LIMITS.screenshotCount) throw new HttpError(400, "at most two screenshots are allowed");
    const screenshots: FeedbackScreenshot[] = [];
    for (const file of files) {
      if (typeof file === "string") throw new HttpError(400, "screenshots must be files");
      if (file.size > FEEDBACK_LIMITS.screenshotBytes) throw new HttpError(413, "each screenshot must be at most 2 MiB");
      const bytes = Buffer.from(await file.arrayBuffer());
      const type = sniff(bytes);
      if (!type || (type.mime !== "image/png" && type.mime !== "image/jpeg" && type.mime !== "image/webp")) {
        throw new HttpError(400, "screenshots must contain PNG, JPEG, or WebP image bytes");
      }
      screenshots.push({ name: `screenshot-${screenshots.length + 1}${type.ext}`, contentType: type.mime, bytes });
    }
    // Reuse ordinary direct-link access policy rather than trusting a client-supplied link.
    if (payload.kind === "report") {
      if (payload.target.kind === "meme") await loadMeme(sql, payload.target.id, user);
      else await loadTemplate(sql, payload.target.id, user);
    }
    await connector.deliver({ payload, user: { id: user.id, username: user.username }, screenshots });
    return c.json({ delivered: true });
  });
}
