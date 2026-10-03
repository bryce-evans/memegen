import type { Context } from "hono";
import type { User } from "@memegen/shared";
import type { Sql } from "./db.ts";
import { HttpError } from "./http.ts";

/**
 * Resolves the acting user for a request. Swap the implementation for a real
 * provider (OAuth, sessions) without touching route handlers.
 */
export interface AuthProvider {
  readonly name: string;
  resolve(c: Context): Promise<User | null>;
}

/** A `users` row as selected by `select id, username, created_at`. */
export interface UserRow {
  id: string;
  username: string;
  created_at: Date;
}

export function toUser(r: UserRow): User {
  return { id: r.id, username: r.username, createdAt: r.created_at.toISOString() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DEV ONLY: trusts the `X-User-Id` header. No authentication whatsoever. */
export class HeaderAuthProvider implements AuthProvider {
  readonly name = "header";
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async resolve(c: Context): Promise<User | null> {
    const id = c.req.header("x-user-id");
    if (!id) return null;
    if (!UUID_RE.test(id)) throw new HttpError(401, "invalid X-User-Id");
    const [row] = await this.sql<UserRow[]>`select id, username, created_at from users where id = ${id}`;
    if (!row) throw new HttpError(401, "unknown user");
    return toUser(row);
  }
}
