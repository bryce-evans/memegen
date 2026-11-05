import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("config diagnostics redact database credentials and feedback connector secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memegen-config-test-"));
  const file = join(dir, "dev.env");
  const keys = ["DATABASE_URL", "TEST_DATABASE_URL", "E2E_DATABASE_URL", "SNAPSHOT_TEST_DATABASE_URL"];
  try {
    await writeFile(file, ["MODE=dev", "WEB_PORT=5173", "INTERNAL_TOKEN=token-secret",
      "FEEDBACK_WEBHOOK_URL=https://feedback.example.com/secret-path?key=query-secret",
      "FEEDBACK_WEBHOOK_TOKEN=feedback-token", "FEEDBACK_SLACK_BOT_TOKEN=slack-token", "SMTP_PASSWORD=smtp-secret",
      ...keys.map((key) => `${key}=postgres://tester:password-secret@localhost/memegen?sslpassword=query-secret`)].join("\n"));
    const output = execFileSync("bash", ["run.sh", file, "config"], { encoding: "utf8" });
    for (const key of keys) assert.ok(output.includes(`${key}=****\n`));
    assert.ok(output.includes("INTERNAL_TOKEN=****\n"));
    assert.ok(output.includes("WEB_PORT=5173\n"));
    for (const key of ["FEEDBACK_WEBHOOK_URL", "FEEDBACK_WEBHOOK_TOKEN", "FEEDBACK_SLACK_BOT_TOKEN", "SMTP_PASSWORD"]) {
      assert.ok(output.includes(`${key}=****\n`));
    }
    for (const secret of ["password-secret", "query-secret", "token-secret", "secret-path", "feedback-token", "slack-token", "smtp-secret"]) {
      assert.equal(output.includes(secret), false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
