import assert from "node:assert/strict";
import { test } from "node:test";
import { feedbackConfigFromEnv } from "./feedback-config.ts";

const email = { FEEDBACK_PROVIDER: "email", SMTP_HOST: "smtp.example.com", FEEDBACK_EMAIL_FROM: "app@example.com", FEEDBACK_EMAIL_TO: "support@example.com" };

test("production requires configured delivery and TLS email", () => {
  for (const env of [{}, { FEEDBACK_PROVIDER: "disabled" }, { FEEDBACK_PROVIDER: "unknown" }]) {
    assert.throws(() => feedbackConfigFromEnv(env), /FEEDBACK_PROVIDER/);
  }
  assert.deepEqual(feedbackConfigFromEnv({ MODE: "dev" }), { provider: "disabled" });
  const startTls = feedbackConfigFromEnv(email);
  assert.equal(startTls.provider, "email");
  if (startTls.provider !== "email") return;
  assert.equal(startTls.requireTLS, true);
  assert.equal(startTls.secure, false);
  const tls = feedbackConfigFromEnv({ ...email, SMTP_PORT: "465", SMTP_SECURE: "true" });
  assert.equal(tls.provider === "email" && tls.secure, true);
  for (const settings of [{ SMTP_PORT: "25" }, { SMTP_PORT: "465" }, { SMTP_SECURE: "true" }, { SMTP_SECURE: "yes" }, { SMTP_PORT: "587oops" }, { SMTP_USER: "only-user" }]) {
    assert.throws(() => feedbackConfigFromEnv({ ...email, ...settings }));
  }
  assert.throws(() => feedbackConfigFromEnv({ ...email, FEEDBACK_EMAIL_TO: "support@example.com\r\nBcc: evil@example.com" }), /control/);
});

test("webhook destinations require HTTPS except explicit loopback development", () => {
  for (const url of ["http://example.com/send", "http://localhost/send", "https://user:secret@example.com/send", "https://example.com/send#secret", "file:///etc/passwd"]) {
    assert.throws(() => feedbackConfigFromEnv({ FEEDBACK_PROVIDER: "webhook", FEEDBACK_WEBHOOK_URL: url }), /FEEDBACK_WEBHOOK_URL/);
  }
  for (const url of ["http://localhost:1234/send", "http://127.0.0.1:1234/send", "http://[::1]:1234/send"]) {
    assert.equal(feedbackConfigFromEnv({ MODE: "dev", FEEDBACK_PROVIDER: "webhook", FEEDBACK_WEBHOOK_URL: url }).provider, "webhook");
  }
  assert.throws(() => feedbackConfigFromEnv({ MODE: "dev", FEEDBACK_PROVIDER: "webhook", FEEDBACK_WEBHOOK_URL: "http://remote.test/send" }));
  assert.throws(() => feedbackConfigFromEnv({ FEEDBACK_PROVIDER: "webhook", FEEDBACK_WEBHOOK_URL: "https://example.com", FEEDBACK_WEBHOOK_TOKEN: "secret\r\nother: value" }), /FEEDBACK_WEBHOOK_TOKEN/);
});

test("Slack requires both a bot credential and a channel ID without disclosing credential errors", () => {
  assert.throws(() => feedbackConfigFromEnv({ FEEDBACK_PROVIDER: "slack", FEEDBACK_SLACK_BOT_TOKEN: "secret" }), /FEEDBACK_SLACK_CHANNEL/);
  assert.throws(() => feedbackConfigFromEnv({ FEEDBACK_PROVIDER: "slack", FEEDBACK_SLACK_BOT_TOKEN: "secret", FEEDBACK_SLACK_CHANNEL: "#public" }), /channel ID/);
  assert.deepEqual(feedbackConfigFromEnv({ FEEDBACK_PROVIDER: "slack", FEEDBACK_SLACK_BOT_TOKEN: "secret", FEEDBACK_SLACK_CHANNEL: "C123" }), { provider: "slack", token: "secret", channel: "C123" });
});
