import postgres from "postgres";
import { config } from "./config.ts";

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;
export type SqlFragment = postgres.PendingQuery<postgres.Row[]>;

export function createSql(url = config.databaseUrl): Sql {
  return postgres(url, {
    max: 10,
    onnotice: () => {},
    transform: { undefined: null },
  });
}
