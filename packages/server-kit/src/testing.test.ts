import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDisposableDatabase } from "./testing.ts";

const main = { MODE: "dev", DATABASE_URL: "postgres://localhost/memegen" };

test("destructive database purposes accept only their dedicated names", () => {
  const names = ["memegen_test", "memegen_snapshot_test", "memegen_e2e", "memegen", "production_e2e", "memegen_test_backup"];
  for (const [purpose, expected] of [["integration", "memegen_test"], ["snapshot", "memegen_snapshot_test"], ["e2e", "memegen_e2e"]] as const) {
    const accepted = names.filter((name) => {
      try {
        assertDisposableDatabase(`postgresql://tester:secret@remote.example/${name}?sslmode=require`, purpose, main);
        return true;
      } catch {
        return false;
      }
    });
    assert.deepEqual(accepted, [expected]);
  }
});

test("main database separation does not depend on credentials, host aliases, or URL encoding", () => {
  for (const databaseUrl of ["postgres://other:password@127.0.0.1:5432/memegen_test", "postgresql://db.example/%6demegen_test"]) {
    assert.throws(() => assertDisposableDatabase("postgres://localhost/memegen_test", "integration", { ...main, DATABASE_URL: databaseUrl }), /main database/);
  }
  assert.throws(() => assertDisposableDatabase("postgres://localhost/memegen_e2e", "e2e", { ...main, MODE: "prod" }), /prod mode/);
});

test("connection target overrides and malformed URLs fail closed without leaking credentials", () => {
  for (const suffix of ["?database=memegen", "?dbname=memegen", "?host=production", "?port=5433", "?service=production", "#fragment"]) {
    assert.throws(() => assertDisposableDatabase(`postgres://user:top-secret@localhost/memegen_test${suffix}`, "integration", main), /without target overrides/);
  }
  for (const value of ["top-secret", "http://user:top-secret@localhost/memegen_test", "postgres://localhost/%ZZ"]) {
    assert.throws(() => assertDisposableDatabase(value, "integration", main), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /PostgreSQL URL/);
      assert.equal(error.message.includes("top-secret"), false);
      return true;
    });
  }
  assert.throws(() => assertDisposableDatabase("postgres://localhost/memegen_test", "integration", { ...main, DATABASE_URL: "postgres://localhost/memegen?database=memegen_test" }), /without target overrides/);
});
