import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSql, type Sql } from "./db.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** Applies pending `db/migrations/*.sql` in filename order, each in its own transaction. */
export async function migrate(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    ran.push(file);
  }
  return ran;
}

if (import.meta.main) {
  const sql = createSql();
  try {
    const ran = await migrate(sql);
    console.log(ran.length ? `applied: ${ran.join(", ")}` : "up to date");
  } finally {
    await sql.end();
  }
}
