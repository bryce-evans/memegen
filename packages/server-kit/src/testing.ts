import { createSql, type Sql } from "./db.ts";
import { migrate } from "./migrate.ts";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/memegen_test";

/** Fresh schema in the test database. Test files run serially (--test-concurrency=1). */
export async function freshTestDb(): Promise<Sql> {
  const sql = createSql(TEST_DATABASE_URL);
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
  await migrate(sql);
  return sql;
}
