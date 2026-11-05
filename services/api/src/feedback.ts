import nodemailer from "nodemailer";
import { HttpError } from "@memegen/server-kit";
import { feedbackConfigFromEnv, type FeedbackSettings } from "@memegen/server-kit/feedback-config";
import type { FeedbackPayload } from "@memegen/shared";

export interface FeedbackScreenshot {
  name: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer<ArrayBuffer>;
}
export interface FeedbackSubmission {
  payload: FeedbackPayload;
  user: { id: string; username: string };
  screenshots: FeedbackScreenshot[];
}
export interface FeedbackConnector {
  readonly enabled: boolean;
  deliver(submission: FeedbackSubmission): Promise<void>;
}
export type FeedbackTransport = (url: string, init: RequestInit) => Promise<Response>;

/** Injection changes transport only: production Slack destinations are never configurable. */
export function createFeedbackConnector(settings: FeedbackSettings, transport: FeedbackTransport = fetch): FeedbackConnector {
  if (settings.provider === "disabled") return {
    enabled: false,
    async deliver() { throw new HttpError(503, "Feedback delivery is not configured"); },
  };
  const mailer = settings.provider === "email" ? nodemailer.createTransport({
    host: settings.host, port: settings.port, secure: settings.secure, requireTLS: settings.requireTLS,
    auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true,
  }) : null;
  return {
    enabled: true,
    async deliver(submission) {
      const { payload, user, screenshots } = submission;
      const target = payload.kind === "report" ? `\nTarget: ${payload.target.kind === "meme" ? "/m/" : "/create?template="}${payload.target.id}\nReason: ${payload.reason}` : "";
      const text = `Feedback: ${payload.kind}\nFrom: ${user.username} (${user.id})\nPage: ${payload.path}${target}\n\n${payload.message}`;
      try {
        switch (settings.provider) {
          case "email": {
            const result = await mailer!.sendMail({
              from: settings.from, to: settings.to, subject: `[memegen] ${payload.kind}`, text,
              attachments: screenshots.map((file) => ({ filename: file.name, contentType: file.contentType, content: file.bytes })),
            });
            if (!result.accepted?.includes(settings.to) || result.rejected?.length) throw new Error("SMTP recipient rejected");
            break;
          }
          case "webhook": {
            const response = await transport(settings.url, {
              method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
              headers: { "content-type": "application/json", ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {}) },
              body: JSON.stringify({
                ...payload, user,
                screenshots: screenshots.map((file) => ({ name: file.name, contentType: file.contentType, base64: file.bytes.toString("base64") })),
              }),
            });
            if (!response.ok) throw new Error("Webhook rejected delivery");
            if (response.headers.get("content-type")?.includes("application/json")) {
              const result: unknown = await response.json();
              if (result && typeof result === "object" && (
                ("ok" in result && result.ok === false) || ("success" in result && result.success === false) ||
                ("delivered" in result && result.delivered === false) || ("error" in result && Boolean(result.error))
              )) throw new Error("Webhook reported delivery failure");
            } else await response.body?.cancel();
            break;
          }
          case "slack": {
            const call = async (method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
              const form = method === "files.getUploadURLExternal";
              const response = await transport(`https://slack.com/api/${method}`, {
                method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
                headers: { authorization: `Bearer ${settings.token}`, "content-type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
                body: form ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])) : JSON.stringify(body),
              });
              if (!response.ok) throw new Error("Slack request failed");
              const result: unknown = await response.json();
              if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) throw new Error("Slack rejected delivery");
              return result as Record<string, unknown>;
            };
            const message = await call("chat.postMessage", {
              channel: settings.channel, text, mrkdwn: false, parse: "none", unfurl_links: false, unfurl_media: false,
            });
            if (typeof message.ts !== "string" || !message.ts) throw new Error("Slack omitted message receipt");
            if (!screenshots.length) break;
            const files: { id: string; title: string }[] = [];
            for (const file of screenshots) {
              const upload = await call("files.getUploadURLExternal", { filename: file.name, length: file.bytes.length });
              if (typeof upload.upload_url !== "string" || typeof upload.file_id !== "string" || !upload.file_id) throw new Error("Slack omitted upload details");
              const destination = new URL(upload.upload_url);
              if (destination.protocol !== "https:" || destination.hostname !== "files.slack.com" || destination.username || destination.password || destination.port || destination.hash) {
                throw new Error("Slack returned an unsafe upload destination");
              }
              const response = await transport(destination.href, {
                method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
                headers: { "content-type": "application/octet-stream" }, body: file.bytes,
              });
              if (!response.ok) throw new Error("Slack file upload failed");
              await response.body?.cancel();
              files.push({ id: upload.file_id, title: file.name });
            }
            await call("files.completeUploadExternal", { files, channel_id: settings.channel, thread_ts: message.ts });
            break;
          }
        }
      } catch {
        // Provider responses can echo tokens, destinations, or submitted private data. Never log or return them.
        throw new HttpError(502, "Feedback delivery failed. Your message was not confirmed; please try again.");
      }
    },
  };
}

export function feedbackConnectorFromEnv(env: Record<string, string | undefined> = process.env): FeedbackConnector {
  return createFeedbackConnector(feedbackConfigFromEnv(env));
}
