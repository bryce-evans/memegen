import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// These intentionally unsafe app settings would fail setup before any destructive operation.
// Listing a gallery-only selection must not require, launch, or reset that stack.
const env = {
  ...process.env,
  MODE: "prod",
  DATABASE_URL: "postgres://localhost/memegen_e2e",
  E2E_DATABASE_URL: "postgres://localhost/memegen_e2e",
};

test("standard e2e gallery selection lists real specs without app-stack setup", () => {
  const result = spawnSync(process.execPath, ["scripts/e2e.ts", "library-gallery", "--list"], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[library\]/);
  assert.doesNotMatch(result.stdout, /\[chrome\]/);
  assert.doesNotMatch(result.stderr, /refusing to reset|main database/);
});

test("a browser filter matching neither suite fails instead of silently passing", () => {
  const result = spawnSync(process.execPath, ["scripts/e2e.ts", "__no_matching_browser_spec__", "--list"], { env, encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /No tests found in either browser suite/);
  assert.doesNotMatch(result.stderr, /refusing to reset|main database/);
});
