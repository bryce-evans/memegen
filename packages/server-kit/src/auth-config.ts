export type AuthSettings = { mode: "dev" } | {
  mode: "oidc";
  publicOrigin: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  sessionTtlSeconds: number;
};

export function isLoopbackUrl(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Pure deployment validation. Errors name settings, never their secret values. */
export function authConfigFromEnv(env: Record<string, string | undefined>): AuthSettings {
  const dev = env.MODE === "dev";
  const mode = env.AUTH_MODE || (dev ? "dev" : "");
  if (mode === "dev") {
    if (!dev) throw new Error("AUTH_MODE=dev requires MODE=dev");
    return { mode };
  }
  if (mode !== "oidc") throw new Error("AUTH_MODE must explicitly be oidc outside MODE=dev");
  const required = (name: string): string => {
    const value = env[name];
    if (!value?.trim()) throw new Error(`${name} is required for OIDC`);
    return value;
  };
  const url = (name: string): URL => {
    let value: URL;
    try { value = new URL(required(name)); } catch { throw new Error(`${name} must be an absolute URL`); }
    if (value.username || value.password || value.search || value.hash ||
      !(value.protocol === "https:" || (dev && value.protocol === "http:" && isLoopbackUrl(value)))) {
      throw new Error(`${name} requires HTTPS (loopback HTTP is allowed only in MODE=dev), without credentials, query, or fragment`);
    }
    return value;
  };
  const origin = url("PUBLIC_ORIGIN");
  if (origin.pathname !== "/") throw new Error("PUBLIC_ORIGIN must be an origin without a path");
  const issuer = url("OIDC_ISSUER_URL");
  const ttl = env.AUTH_SESSION_TTL_SECONDS || "604800";
  if (!/^\d+$/.test(ttl) || !Number.isSafeInteger(Number(ttl)) || Number(ttl) < 1 || Number(ttl) > 2592000) {
    throw new Error("AUTH_SESSION_TTL_SECONDS must be an integer from 1 through 2592000");
  }
  return {
    mode, publicOrigin: origin.origin, issuerUrl: issuer.href,
    clientId: required("OIDC_CLIENT_ID"), clientSecret: required("OIDC_CLIENT_SECRET"),
    sessionTtlSeconds: Number(ttl),
  };
}
