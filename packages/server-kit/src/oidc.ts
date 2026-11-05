import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import * as oidc from "openid-client";
import type { User } from "@memegen/shared";
import { HeaderAuthProvider, toUser, type AuthProvider, type Env, type UserRow } from "./auth.ts";
import { authConfigFromEnv, isLoopbackUrl, type AuthSettings } from "./auth-config.ts";
import type { Sql } from "./db.ts";
import { HttpError, isInternal } from "./http.ts";

type OidcSettings = Extract<AuthSettings, { mode: "oidc" }>;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const LOGIN_TTL = 600;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Only local absolute paths, never network-path references or URL-parser backslash tricks. */
export function authReturnTo(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20\x7f]/.test(value)) {
    throw new HttpError(400, "returnTo must be a local path");
  }
  // Reject encoded variants too: reverse proxies and client routers may decode before navigating.
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { throw new HttpError(400, "invalid returnTo"); }
  if (decoded.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(decoded)) throw new HttpError(400, "returnTo must be a local path");
  return value;
}

export async function createAuthProvider(sql: Sql, settings: AuthSettings = authConfigFromEnv(process.env)): Promise<AuthProvider> {
  return settings.mode === "dev" ? new HeaderAuthProvider(sql) : await OidcAuthProvider.create(sql, settings);
}

export class OidcAuthProvider implements AuthProvider {
  readonly name = "oidc";
  readonly mode = "oidc";
  private readonly sql: Sql;
  private readonly settings: OidcSettings;
  private readonly client: oidc.Configuration;
  private readonly secure: boolean;
  private readonly sessionCookie: string;
  private readonly loginCookie: string;

  private constructor(sql: Sql, settings: OidcSettings, client: oidc.Configuration) {
    this.sql = sql;
    this.settings = settings;
    this.client = client;
    this.secure = new URL(settings.publicOrigin).protocol === "https:";
    this.sessionCookie = this.secure ? "__Host-memegen_session" : "memegen_dev_session";
    this.loginCookie = this.secure ? "__Host-memegen_login" : "memegen_dev_login";
  }

  static async create(sql: Sql, settings: OidcSettings): Promise<OidcAuthProvider> {
    // Revalidate even direct construction; callers cannot enable plaintext OIDC in production.
    const validated = authConfigFromEnv({
      MODE: process.env.MODE, AUTH_MODE: "oidc", PUBLIC_ORIGIN: settings.publicOrigin,
      OIDC_ISSUER_URL: settings.issuerUrl, OIDC_CLIENT_ID: settings.clientId,
      OIDC_CLIENT_SECRET: settings.clientSecret, AUTH_SESSION_TTL_SECONDS: String(settings.sessionTtlSeconds),
    }) as OidcSettings;
    const dev = process.env.MODE === "dev";
    const basic = oidc.ClientSecretBasic(validated.clientSecret);
    const post = oidc.ClientSecretPost(validated.clientSecret);
    const authenticate: oidc.ClientAuth = (server, client, body, headers) => {
      const methods = server.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
      if (methods.includes("client_secret_basic")) basic(server, client, body, headers);
      else if (methods.includes("client_secret_post")) post(server, client, body, headers);
      else throw new Error("OIDC issuer must support client_secret_basic or client_secret_post");
    };
    let client: oidc.Configuration;
    try {
      client = await oidc.discovery(new URL(validated.issuerUrl), validated.clientId, validated.clientSecret, authenticate, {
        execute: dev ? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] : [oidc.enableNonRepudiationChecks],
        [oidc.customFetch]: async (input, options) => {
          const url = new URL(input);
          if (url.protocol !== "https:" && !(dev && url.protocol === "http:" && isLoopbackUrl(url))) {
            throw new Error("OIDC endpoints require HTTPS outside development loopback");
          }
          // Node fetch accepts the library's Uint8Array bodies; DOM typings narrow their buffer type.
          return fetch(input, { ...options, body: options.body as BodyInit, redirect: "error" });
        },
      });
      const metadata = client.serverMetadata();
      if (!(metadata.token_endpoint_auth_methods_supported ?? ["client_secret_basic"]).some((method) =>
        method === "client_secret_basic" || method === "client_secret_post")) throw new Error();
      for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
        if (!endpoint) throw new Error();
        const url = new URL(endpoint);
        if (url.username || url.password || (url.protocol !== "https:" && !(dev && url.protocol === "http:" && isLoopbackUrl(url)))) throw new Error();
      }
    } catch {
      // Provider exceptions may contain tokens, client credentials, or provider response bodies.
      throw new Error("OIDC discovery failed; verify issuer, client settings, and HTTPS endpoints");
    }
    return new OidcAuthProvider(sql, validated, client);
  }

  protectRequest(c: Context): void {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return;
    // Internal bearer access is independent of browser sessions, including storage deletes.
    if (isInternal(c) && (c.req.path.startsWith("/internal/") || c.req.path === "/assets" || c.req.path.startsWith("/assets/"))) return;
    if (c.req.header("origin") !== this.settings.publicOrigin) throw new HttpError(403, "same-origin request required");
  }

  async resolve(c: Context): Promise<User | null> {
    const token = getCookie(c, this.sessionCookie);
    if (!token || !TOKEN_RE.test(token)) return null;
    const [row] = await this.sql<UserRow[]>`
      select u.id, u.username, u.created_at, u.is_admin from auth_sessions s
      join users u on u.id = s.user_id
      where s.token_hash = ${tokenHash(token)} and s.expires_at > now()`;
    return row ? toUser(row) : null;
  }

  private cookie(c: Context, name: string, value: string, maxAge: number): void {
    setCookie(c, name, value, { secure: this.secure, httpOnly: true, sameSite: "Lax", path: "/", maxAge });
  }

  registerRoutes(app: Hono<Env>): void {
    app.get("/api/auth/login", async (c) => {
      const returnTo = authReturnTo(c.req.query("returnTo"));
      const state = oidc.randomState();
      const browser = randomBytes(32).toString("base64url");
      const verifier = oidc.randomPKCECodeVerifier();
      const nonce = oidc.randomNonce();
      const authorization = oidc.buildAuthorizationUrl(this.client, {
        redirect_uri: `${this.settings.publicOrigin}/api/auth/callback`, scope: "openid",
        code_challenge_method: "S256", code_challenge: await oidc.calculatePKCECodeChallenge(verifier), state, nonce,
      });
      await this.sql`delete from auth_login_transactions where expires_at <= now()`;
      await this.sql`insert into auth_login_transactions (state_hash, browser_hash, code_verifier, nonce, return_to, expires_at)
        values (${tokenHash(state)}, ${tokenHash(browser)}, ${verifier}, ${nonce}, ${returnTo}, now() + ${LOGIN_TTL} * interval '1 second')`;
      this.cookie(c, this.loginCookie, browser, LOGIN_TTL);
      return c.redirect(authorization.href, 302);
    });

    app.get("/api/auth/callback", async (c) => {
      const browser = getCookie(c, this.loginCookie);
      const state = c.req.query("state");
      this.cookie(c, this.loginCookie, "", 0);
      if (!browser || !TOKEN_RE.test(browser) || !state || !TOKEN_RE.test(state)) throw new HttpError(400, "invalid or expired login");
      // DELETE RETURNING consumes the transaction atomically before any token exchange (including failures).
      const [transaction] = await this.sql<{ code_verifier: string; nonce: string; return_to: string }[]>`
        delete from auth_login_transactions where state_hash = ${tokenHash(state)}
          and browser_hash = ${tokenHash(browser)} and expires_at > now()
        returning code_verifier, nonce, return_to`;
      if (!transaction) throw new HttpError(400, "invalid or expired login");
      let subject: string;
      try {
        // Do not trust the reverse proxy Host/proto headers for the registered redirect URI.
        const callback = new URL(`${this.settings.publicOrigin}/api/auth/callback`);
        callback.search = new URL(c.req.url).search;
        const tokens = await oidc.authorizationCodeGrant(this.client, callback, {
          pkceCodeVerifier: transaction.code_verifier, expectedState: state, expectedNonce: transaction.nonce, idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims?.sub) throw new Error();
        subject = claims.sub;
      } catch {
        throw new HttpError(400, "OIDC login could not be verified");
      }
      const issuer = this.client.serverMetadata().issuer;
      const token = randomBytes(32).toString("base64url");
      const previousToken = getCookie(c, this.sessionCookie);
      await this.sql.begin(async (tx) => {
        // Serialize first login for this identity without deriving account ownership from profile claims.
        await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([issuer, subject])}, 0))`;
        let [identity] = await tx<{ user_id: string }[]>`select user_id from auth_identities where issuer = ${issuer} and subject = ${subject}`;
        if (!identity) {
          let user: { id: string } | undefined;
          while (!user) {
            const username = `member_${randomBytes(12).toString("hex")}`;
            [user] = await tx<{ id: string }[]>`insert into users (username, is_admin) values (${username}, false)
              on conflict (lower(username)) do nothing returning id`;
          }
          [identity] = await tx<{ user_id: string }[]>`insert into auth_identities (issuer, subject, user_id)
            values (${issuer}, ${subject}, ${user.id}) returning user_id`;
        }
        if (previousToken && TOKEN_RE.test(previousToken)) await tx`delete from auth_sessions where token_hash = ${tokenHash(previousToken)}`;
        await tx`delete from auth_sessions where expires_at <= now()`;
        await tx`insert into auth_sessions (token_hash, user_id, expires_at)
          values (${tokenHash(token)}, ${identity!.user_id}, now() + ${this.settings.sessionTtlSeconds} * interval '1 second')`;
      });
      this.cookie(c, this.sessionCookie, token, this.settings.sessionTtlSeconds);
      return c.redirect(authReturnTo(transaction.return_to), 302);
    });

    app.delete("/api/session", async (c) => {
      const token = getCookie(c, this.sessionCookie);
      if (token && TOKEN_RE.test(token)) await this.sql`delete from auth_sessions where token_hash = ${tokenHash(token)}`;
      this.cookie(c, this.sessionCookie, "", 0);
      return c.body(null, 204);
    });
  }
}
