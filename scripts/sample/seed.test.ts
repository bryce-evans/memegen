import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { freshTestDb, TEST_DATABASE_URL } from "@memegen/server-kit/testing";
import { SAMPLE_USERS } from "./data.ts";

const exec = promisify(execFile);
const seed = (mode: string) => exec(process.execPath, ["scripts/sample/seed.ts"], {
  env: { ...process.env, MODE: mode, DATABASE_URL: TEST_DATABASE_URL },
});

test("sample seed creates bae and restores its admin role without duplicating existing accounts", async () => {
  const sql = await freshTestDb();
  try {
    await sql`insert into users (username) values (${SAMPLE_USERS[0]})`;
    await seed("dev");
    const [created] = await sql<{ id: string; is_admin: boolean }[]>`select id, is_admin from users where lower(username) = 'bae'`;
    assert.equal(created!.is_admin, true);
    await sql`update users set username = 'BAE', is_admin = false where id = ${created!.id}`;
    await seed("dev");
    const accounts = await sql<{ id: string; username: string; is_admin: boolean }[]>`select id, username, is_admin from users where lower(username) = 'bae'`;
    assert.deepEqual([...accounts], [{ id: created!.id, username: "BAE", is_admin: true }]);
    const [ordinary] = await sql<{ is_admin: boolean }[]>`select is_admin from users where username = ${SAMPLE_USERS[0]}`;
    assert.equal(ordinary!.is_admin, false);
    await sql`update users set is_admin = false where id = ${created!.id}`;
    await assert.rejects(seed("prod"), /Sample data seeding requires MODE=dev/);
    const [unchanged] = await sql<{ is_admin: boolean }[]>`select is_admin from users where id = ${created!.id}`;
    assert.equal(unchanged!.is_admin, false);
  } finally {
    await sql.end();
  }
});
