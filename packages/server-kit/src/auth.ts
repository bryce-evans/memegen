import type { Context, Hono } from "hono";
import { sessionSchema, type AuthConfig, type AuthSession, type User } from "@memegen/shared";
import type { Sql, TransactionSql } from "./db.ts";
import { HttpError, parseJson } from "./http.ts";

/**
 * Resolves the acting user for a request. Swap the implementation for a real
 * provider (OAuth, sessions) without touching route handlers.
 */
export interface AuthProvider {
  readonly name: string;
  readonly mode: "dev" | "oidc";
  protectRequest?(c: Context): void;
  registerRoutes?(app: Hono<Env>): void;
  resolve(c: Context): Promise<User | null>;
}

/** Hono env for apps with `installAuth`: routes read the acting user (null = anonymous) via `c.get("user")`. */
export type Env = { Variables: { user: User | null } };

/** Resolve the user once per request, before any route runs. */
export function installAuth(app: Hono<Env>, auth: AuthProvider): void {
  app.use("*", async (c, next) => {
    auth.protectRequest?.(c);
    c.set("user", await auth.resolve(c));
    await next();
  });
}

/** Authentication routes belong to the configured provider, never the users resource. */
export function registerAuthRoutes(app: Hono<Env>, auth: AuthProvider): void {
  app.use("/api/auth/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.use("/api/session", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/api/auth/config", (c) => c.json({
    mode: auth.mode, loginUrl: auth.mode === "oidc" ? "/api/auth/login" : null,
  } satisfies AuthConfig));
  app.get("/api/auth/session", (c) => c.json({ user: c.get("user") } satisfies AuthSession));
  auth.registerRoutes?.(app);
}

/** A `users` row including its database-owned moderation role. */
export interface UserRow {
  id: string;
  username: string;
  created_at: Date;
  is_admin: boolean;
}

export function toUser(r: UserRow): User {
  return { id: r.id, username: r.username, createdAt: r.created_at.toISOString(), isAdmin: r.is_admin };
}

/** Called only inside a successful sign-in transaction; ordinary resolves never write analytics. */
export async function recordSuccessfulLogin(sql: TransactionSql, userId: string): Promise<void> {
  await sql`insert into daily_user_logins (user_id)
    select id from users where id = ${userId} and lower(username) <> 'memegen'
    on conflict (date, user_id) do nothing`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DEV ONLY: trusts the `X-User-Id` header. No authentication whatsoever. */
export class HeaderAuthProvider implements AuthProvider {
  readonly name = "header";
  readonly mode = "dev";
  private readonly sql: Sql;
  constructor(sql: Sql) {
    if (process.env.MODE !== "dev" || (process.env.AUTH_MODE && process.env.AUTH_MODE !== "dev")) {
      throw new Error("HeaderAuthProvider requires MODE=dev and AUTH_MODE=dev");
    }
    this.sql = sql;
  }

  async resolve(c: Context): Promise<User | null> {
    const id = c.req.header("x-user-id");
    if (!id) return null;
    if (!UUID_RE.test(id)) throw new HttpError(401, "invalid X-User-Id");
    const [row] = await this.sql<UserRow[]>`select id, username, created_at, is_admin from users where id = ${id}`;
    if (!row) throw new HttpError(401, "unknown user");
    return toUser(row);
  }

  registerRoutes(app: Hono<Env>): void {
    app.post("/api/session", async (c) => {
      const { username } = await parseJson(c, sessionSchema);
      const user = await this.sql.begin(async (tx) => {
        const [row] = await tx<UserRow[]>`
          insert into users (username) values (${username})
          on conflict (lower(username)) do update set username = users.username
          returning id, username, created_at, is_admin`;
        await recordSuccessfulLogin(tx, row!.id);
        return toUser(row!);
      });
      return c.json({ user });
    });
    app.delete("/api/session", (c) => c.body(null, 204));
  }
}
