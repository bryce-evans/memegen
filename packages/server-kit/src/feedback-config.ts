import { isLoopbackUrl } from "./auth-config.ts";

export type FeedbackSettings =
  | { provider: "disabled" }
  | { provider: "email"; host: string; port: number; secure: boolean; requireTLS: boolean; user?: string; password?: string; from: string; to: string }
  | { provider: "slack"; token: string; channel: string }
  | { provider: "webhook"; url: string; token?: string };

/** Pure startup/preflight validation; errors never contain connector credentials. */
export function feedbackConfigFromEnv(env: Record<string, string | undefined>): FeedbackSettings {
  const dev = env.MODE === "dev";
  const provider = env.FEEDBACK_PROVIDER || (dev ? "disabled" : "");
  const required = (name: string): string => {
    const value = env[name];
    if (!value?.trim()) throw new Error(`${name} is required for feedback`);
    if (/[\r\n\u0000]/.test(value)) throw new Error(`${name} must not contain control characters`);
    return value;
  };
  switch (provider) {
    case "disabled":
      if (!dev) throw new Error("FEEDBACK_PROVIDER=disabled requires MODE=dev");
      return { provider };
    case "email": {
      const host = required("SMTP_HOST");
      if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw new Error("SMTP_HOST must be a hostname or IP address");
      const rawPort = env.SMTP_PORT || "587";
      if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error("SMTP_PORT must be an integer from 1 through 65535");
      const port = Number(rawPort);
      const rawSecure = env.SMTP_SECURE || "false";
      if (!["true", "false"].includes(rawSecure)) throw new Error("SMTP_SECURE must be true or false");
      const secure = rawSecure === "true";
      if (!dev && !((secure && port === 465) || (!secure && port === 587))) {
        throw new Error("Production SMTP requires implicit TLS on port 465 or STARTTLS on port 587");
      }
      if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
      const from = required("FEEDBACK_EMAIL_FROM");
      const to = required("FEEDBACK_EMAIL_TO");
      if (![from, to].every((value) => /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value))) {
        throw new Error("FEEDBACK_EMAIL_FROM and FEEDBACK_EMAIL_TO must each be one email address");
      }
      return {
        provider, host, port, secure, requireTLS: !dev && !secure, from, to,
        ...(env.SMTP_USER ? { user: required("SMTP_USER"), password: required("SMTP_PASSWORD") } : {}),
      };
    }
    case "slack": {
      const token = required("FEEDBACK_SLACK_BOT_TOKEN");
      const channel = required("FEEDBACK_SLACK_CHANNEL");
      if (!/^[CG][A-Z0-9]+$/.test(channel)) throw new Error("FEEDBACK_SLACK_CHANNEL must be a Slack channel ID");
      return { provider, token, channel };
    }
    case "webhook": {
      let url: URL;
      try { url = new URL(required("FEEDBACK_WEBHOOK_URL")); } catch { throw new Error("FEEDBACK_WEBHOOK_URL must be an absolute URL"); }
      if (url.username || url.password || url.hash || !(url.protocol === "https:" || (dev && url.protocol === "http:" && isLoopbackUrl(url)))) {
        throw new Error("FEEDBACK_WEBHOOK_URL requires HTTPS (loopback HTTP only in MODE=dev), without URL credentials or fragment");
      }
      return { provider, url: url.href, ...(env.FEEDBACK_WEBHOOK_TOKEN ? { token: required("FEEDBACK_WEBHOOK_TOKEN") } : {}) };
    }
    default:
      throw new Error("FEEDBACK_PROVIDER must be email, slack, or webhook (disabled is allowed only in MODE=dev)");
  }
}
