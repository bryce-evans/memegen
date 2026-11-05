import type { User } from "@memegen/shared";
import type { Sql, TransactionSql } from "./db.ts";
import { HttpError } from "./http.ts";

/** Transaction-local actor context lets deletion triggers capture dependent rows atomically too. */
export async function deletionTransaction<T>(
  sql: Sql,
  actor: User | null,
  work: (tx: TransactionSql) => Promise<T>,
  adminOnly = false,
  serializeAccounts = false,
): Promise<T> {
  return await sql.begin(async (tx) => {
    // Acquire before actor row locks so two administrators cannot deadlock deleting one another.
    if (serializeAccounts) await tx`select pg_advisory_xact_lock(194731, 20)`;
    if (actor) {
      // A role change cannot commit while this deletion is in flight. Never trust a cached role.
      const [current] = await tx<{ username: string; is_admin: boolean }[]>`
        select username, is_admin from users where id = ${actor.id} for share`;
      if (!current) throw new HttpError(401, "account no longer exists");
      if ((adminOnly || actor.isAdmin) && !current.is_admin) throw new HttpError(403, "admin role required");
      if (current.is_admin) {
        await tx`select set_config('memegen.admin_actor_id', ${actor.id}, true),
          set_config('memegen.admin_actor_name', ${current.username}, true)`;
      }
    } else if (adminOnly) {
      throw new HttpError(401, "sign in required");
    }
    return await work(tx);
  }) as T;
}
