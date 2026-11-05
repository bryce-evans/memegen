import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer as createHttpServer } from "node:http";
import { createServer as createSmtpServer } from "node:net";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { z } from "zod";
import { HttpError } from "@memegen/server-kit";
import { feedbackConfigFromEnv } from "@memegen/server-kit/feedback-config";
import { createFeedbackConnector, type FeedbackSubmission } from "./feedback.ts";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBqUAAAAASUVORK5CYII=", "base64");
const submission: FeedbackSubmission = {
  payload: { kind: "bug", message: "The preview is broken", path: "/create" },
  user: { id: "10000000-0000-4000-8000-000000000001", username: "reporter" },
  screenshots: [{ name: "screenshot-1.png", contentType: "image/png", bytes: image }],
};

function deliveryFailure(error: unknown): boolean {
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 502);
  assert.doesNotMatch(error.message, /secret|credential|fixture rejection/);
  return true;
}

test("SMTP delivers real MIME attachments and rejects failed recipients without leaking server text", async (t) => {
  const messages: string[] = [];
  const envelopes: string[] = [];
  let rejectRecipient = false;
  const server = createSmtpServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost fixture\r\n");
    let buffer = "";
    let data = false;
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        if (data) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          data = false;
          socket.write("250 queued\r\n");
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO|^HELO/.test(line)) socket.write("250 localhost\r\n");
        else if (/^MAIL FROM:|^RCPT TO:/.test(line)) {
          envelopes.push(line);
          socket.write(rejectRecipient && line.startsWith("RCPT") ? "550 secret fixture rejection\r\n" : "250 accepted\r\n");
        } else if (line === "DATA") { data = true; socket.write("354 send message\r\n"); }
        else if (line === "QUIT") { socket.end("221 bye\r\n"); return; }
        else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const connector = createFeedbackConnector(feedbackConfigFromEnv({
    MODE: "dev", FEEDBACK_PROVIDER: "email", SMTP_HOST: "127.0.0.1", SMTP_PORT: String((server.address() as AddressInfo).port),
    FEEDBACK_EMAIL_FROM: "app@example.com", FEEDBACK_EMAIL_TO: "support@example.com",
  }));
  await connector.deliver(submission);
  assert.deepEqual(envelopes, ["MAIL FROM:<app@example.com>", "RCPT TO:<support@example.com>"]);
  assert.match(messages[0]!, /Subject: \[memegen\] bug/);
  assert.match(messages[0]!, /The preview is broken/);
  const attachment = messages[0]!.match(/Content-Type: image\/png[^]*?\r\n\r\n([^]*?)\r\n--/);
  assert.ok(attachment);
  assert.deepEqual(Buffer.from(attachment[1]!.replace(/\s/g, ""), "base64"), image);
  rejectRecipient = true;
  await assert.rejects(connector.deliver(submission), deliveryFailure);
  assert.equal(messages.length, 1);
});

test("webhook carries authenticated JSON and exact image bytes and fails HTTP or logical rejections", async (t) => {
  let status = 200;
  let result: unknown = { delivered: true };
  const deliverySchema = z.object({
    user: z.object({ id: z.uuid(), username: z.string() }),
    screenshots: z.array(z.object({ name: z.string(), contentType: z.string(), base64: z.string() })),
  }).passthrough();
  const received: { authorization: string | undefined; body: z.output<typeof deliverySchema> }[] = [];
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({ authorization: request.headers.authorization, body: deliverySchema.parse(JSON.parse(Buffer.concat(chunks).toString())) });
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(result));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const connector = createFeedbackConnector(feedbackConfigFromEnv({ MODE: "dev", FEEDBACK_PROVIDER: "webhook", FEEDBACK_WEBHOOK_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/deliver`, FEEDBACK_WEBHOOK_TOKEN: "secret" }));
  await connector.deliver(submission);
  assert.equal(received[0]!.authorization, "Bearer secret");
  const body = received[0]!.body;
  assert.equal(body.message, submission.payload.message);
  assert.deepEqual(body.user, submission.user);
  assert.equal(body.screenshots[0]!.contentType, "image/png");
  assert.deepEqual(Buffer.from(body.screenshots[0]!.base64, "base64"), image);
  status = 503; result = { error: "secret fixture rejection" };
  await assert.rejects(connector.deliver(submission), deliveryFailure);
  status = 200;
  for (const failure of [{ ok: false }, { success: false }, { delivered: false }, { error: "secret fixture rejection" }]) {
    result = failure;
    await assert.rejects(connector.deliver(submission), deliveryFailure);
  }
});

test("Slack transport uses official API endpoints and private binary upload, checking every acknowledgement", async (t) => {
  let failure = "";
  const requests: { path: string; authorization: string | undefined; bytes: Buffer }[] = [];
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const path = request.url!;
    requests.push({ path, authorization: request.headers.authorization, bytes: Buffer.concat(chunks) });
    response.setHeader("content-type", "application/json");
    if (path === failure) return void response.end(JSON.stringify({ ok: false, error: "secret fixture rejection" }));
    if (path === "/api/chat.postMessage") response.end(JSON.stringify({ ok: true, ts: "123.456" }));
    else if (path === "/api/files.getUploadURLExternal") response.end(JSON.stringify({ ok: true, file_id: "F123", upload_url: failure === "unsafe" ? "https://evil.example/upload" : "https://files.slack.com/upload/v1/test" }));
    else if (path === "/upload/v1/test") {
      response.statusCode = failure === "binary" ? 500 : 200;
      response.end("OK - 68");
    } else response.end(JSON.stringify({ ok: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const connector = createFeedbackConnector({ provider: "slack", token: "secret", channel: "C123" }, async (url, init) => {
    const destination = new URL(url);
    assert.ok(["https://slack.com", "https://files.slack.com"].includes(destination.origin));
    return fetch(`${origin}${destination.pathname}`, init);
  });
  await connector.deliver(submission);
  assert.deepEqual(requests.map((r) => r.path), ["/api/chat.postMessage", "/api/files.getUploadURLExternal", "/upload/v1/test", "/api/files.completeUploadExternal"]);
  assert.equal(requests[0]!.authorization, "Bearer secret");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests[1]!.bytes.toString())), { filename: "screenshot-1.png", length: String(image.length) });
  assert.deepEqual(requests[2]!.bytes, image);
  assert.equal(requests[2]!.authorization, undefined);
  assert.deepEqual(JSON.parse(requests[3]!.bytes.toString()), { files: [{ id: "F123", title: "screenshot-1.png" }], channel_id: "C123", thread_ts: "123.456" });
  for (const phase of ["/api/chat.postMessage", "/api/files.getUploadURLExternal", "binary", "/api/files.completeUploadExternal", "unsafe"]) {
    requests.length = 0; failure = phase;
    await assert.rejects(connector.deliver(submission), deliveryFailure);
    if (phase === "unsafe") assert.equal(requests.length, 2);
    if (phase === "/api/chat.postMessage") assert.equal(requests.length, 1);
  }
});
