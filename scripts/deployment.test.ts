import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deploymentIssues } from "./deployment.ts";

const production: NodeJS.ProcessEnv = {
  MODE: "prod",
  AUTH_MODE: "oidc",
  PUBLIC_ORIGIN: "https://memes.example.com",
  OIDC_ISSUER_URL: "https://identity.example.com",
  OIDC_CLIENT_ID: "memegen",
  OIDC_CLIENT_SECRET: "oidc-private-secret",
  DATABASE_URL: "postgres://app:db-private-secret@db.example.com/memegen",
  INTERNAL_TOKEN: "0123456789abcdef0123456789abcdef",
  STORAGE_PROVIDER: "s3",
  S3_BUCKET: "media",
  SEARCH_ENABLED: "false",
};

test("deployment rejects insecure production auth and missing durable storage without requiring optional AI/search", () => {
  assert.deepEqual(deploymentIssues(production), []);
  const issues = deploymentIssues({ ...production, AUTH_MODE: "dev", INTERNAL_TOKEN: "short", STORAGE_PROVIDER: "local" });
  assert.ok(issues.some((issue) => /AUTH_MODE|production|prod/.test(issue) && /oidc|dev/.test(issue)));
  assert.ok(issues.some((issue) => issue.includes("INTERNAL_TOKEN")));
  assert.ok(issues.some((issue) => issue.includes("LOCAL_STORAGE_DIR")));
  assert.deepEqual(deploymentIssues({ ...production, STORAGE_PROVIDER: "local", LOCAL_STORAGE_DIR: "/var/lib/memegen" }), []);
});

test("S3 deployment accepts role credentials but rejects half-configured explicit credentials", () => {
  assert.deepEqual(deploymentIssues(production), []);
  assert.ok(deploymentIssues({ ...production, S3_ACCESS_KEY_ID: "access-private" }).some((issue) => issue.includes("both S3_ACCESS_KEY_ID")));
  assert.ok(deploymentIssues({ ...production, S3_SECRET_ACCESS_KEY: "secret-private" }).some((issue) => issue.includes("both S3_ACCESS_KEY_ID")));
  assert.deepEqual(deploymentIssues({ ...production, S3_ACCESS_KEY_ID: "access-private", S3_SECRET_ACCESS_KEY: "secret-private" }), []);
  assert.ok(deploymentIssues({ ...production, S3_BUCKET: "" }).some((issue) => issue.includes("S3_BUCKET")));
});

test("deployment diagnostics never expose database, OIDC or storage credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memegen-deployment-"));
  const config = join(directory, "dev.env");
  try {
    await writeFile(config, Object.entries({ ...production, MODE: "dev", S3_ACCESS_KEY_ID: "access-private", S3_SECRET_ACCESS_KEY: "secret-private" })
      .map(([key, value]) => `${key}=${value}`).join("\n"));
    const output = execFileSync("bash", ["run.sh", config, "deployment"], { encoding: "utf8" });
    assert.ok(output.includes("https://memes.example.com/api/auth/callback"));
    for (const secret of ["db-private-secret", "oidc-private-secret", "access-private", "secret-private", production.INTERNAL_TOKEN!]) {
      assert.equal(output.includes(secret), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
