import assert from "node:assert/strict";
import { test } from "node:test";
import { authConfigFromEnv } from "./auth-config.ts";
import { HeaderAuthProvider } from "./auth.ts";
import { authReturnTo } from "./oidc.ts";
import type { Sql } from "./db.ts";

const production = {
  MODE: "prod", AUTH_MODE: "oidc", PUBLIC_ORIGIN: "https://memes.example.test",
  OIDC_ISSUER_URL: "https://identity.example.test/realm", OIDC_CLIENT_ID: "client", OIDC_CLIENT_SECRET: "do-not-print-me",
};

test("authentication configuration fails closed outside explicitly insecure development", () => {
  for (const env of [{}, { MODE: "prod" }, { MODE: "prod", AUTH_MODE: "dev" }, { MODE: "dev", AUTH_MODE: "unknown" }]) {
    assert.throws(() => authConfigFromEnv(env));
  }
  assert.deepEqual(authConfigFromEnv({ MODE: "dev" }), { mode: "dev" });
  assert.deepEqual(authConfigFromEnv(production), {
    mode: "oidc", publicOrigin: production.PUBLIC_ORIGIN, issuerUrl: production.OIDC_ISSUER_URL,
    clientId: "client", clientSecret: "do-not-print-me", sessionTtlSeconds: 604800,
  });
  for (const field of ["PUBLIC_ORIGIN", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
    assert.throws(() => authConfigFromEnv({ ...production, [field]: "" }), (error: Error) => !error.message.includes("do-not-print-me"));
  }
});

test("OIDC URL and expiry validation rejects insecure or ambiguous deployment values", () => {
  for (const value of ["http://example.test", "https://example.test/path", "https://user:password@example.test", "https://example.test?secret=x", "//example.test"]) {
    assert.throws(() => authConfigFromEnv({ ...production, PUBLIC_ORIGIN: value }));
  }
  for (const value of ["0", "-1", "1.5", "NaN", "2592001", "1e3"]) {
    assert.throws(() => authConfigFromEnv({ ...production, AUTH_SESSION_TTL_SECONDS: value }));
  }
  assert.throws(() => authConfigFromEnv({ ...production, MODE: "dev", OIDC_ISSUER_URL: "http://remote.test" }));
  assert.equal(authConfigFromEnv({ ...production, MODE: "dev", PUBLIC_ORIGIN: "http://127.0.0.1:3000", OIDC_ISSUER_URL: "http://localhost:8080" }).mode, "oidc");
});

test("direct header provider construction cannot bypass production or OIDC configuration", () => {
  const mode = process.env.MODE;
  const auth = process.env.AUTH_MODE;
  try {
    process.env.MODE = "prod";
    assert.throws(() => new HeaderAuthProvider({} as Sql), /requires MODE=dev/);
    process.env.MODE = "dev";
    process.env.AUTH_MODE = "oidc";
    assert.throws(() => new HeaderAuthProvider({} as Sql), /requires MODE=dev/);
  } finally {
    if (mode === undefined) delete process.env.MODE; else process.env.MODE = mode;
    if (auth === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = auth;
  }
});

test("post-login return paths cannot become external redirects", () => {
  for (const path of ["//evil.test", "/\\evil.test", "https://evil.test", "/%2fevil.test", "/%5cevil.test", "/%0aevil.test", "/bad%zz"]) {
    assert.throws(() => authReturnTo(path));
  }
  assert.equal(authReturnTo("/templates?q=cat#recent"), "/templates?q=cat#recent");
  assert.equal(authReturnTo(undefined), "/");
});
