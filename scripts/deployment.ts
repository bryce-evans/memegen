import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
// Pure modules only: the deployment guide must run before `bun install` creates workspace links.
import { authConfigFromEnv } from "../packages/server-kit/src/auth-config.ts";
import { servicePorts } from "../packages/server-kit/src/ports.ts";

const OPTIONS = `Deployment connectors (edit your KEY=value config; no secrets belong in the browser)

Required
  Database: PostgreSQL — DATABASE_URL; provision a dedicated database and backup policy.
    https://www.postgresql.org/docs/current/runtime-config-connection.html
  Authentication: AUTH_MODE=oidc (recommended for deployment).
    Any standards-compliant confidential OIDC web client with discovery and code + PKCE.
    Set PUBLIC_ORIGIN, OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET.
    Register exactly PUBLIC_ORIGIN/api/auth/callback as the redirect URI; enable openid.
    Hosted: Google https://console.cloud.google.com/apis/credentials
            Auth0 https://manage.auth0.com/
    Self-hosted: Keycloak https://www.keycloak.org/getting-started/getting-started-docker
                 Authentik https://docs.goauthentik.io/add-secure-apps/providers/oauth2/
    AUTH_MODE=dev permits username impersonation and is rejected in production.
  Media: STORAGE_PROVIDER=local or s3.
    local: LOCAL_STORAGE_DIR on a durable volume (back up alongside PostgreSQL).
    s3: S3_BUCKET, S3_REGION; AWS role/default credential chain or BOTH
        S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. Limit access to the media bucket/prefix.
        Optional S3_ENDPOINT for compatible stores, e.g. Cloudflare R2 or MinIO.
    https://console.aws.amazon.com/s3/
    https://developers.cloudflare.com/r2/get-started/s3/
  Public HTTPS: reverse proxy to WEB_PORT; PUBLIC_ORIGIN must match the browser origin.
    Forward Cookie, Set-Cookie and Origin unchanged. Keep API/storage/search ports private.
  Internal services: INTERNAL_TOKEN (at least 32 characters in prod; openssl rand -hex 32).

Optional
  Semantic template search: SEARCH_ENABLED=true; local CLIP/FAISS sidecar, no hosted account.
    First start downloads a model; provide persistent SEARCH_DATA_DIR and sufficient resources.
    SEARCH_ENABLED=false keeps name/tag search and byte-identical duplicate checks.
  AI: users connect OpenAI, Gemini or Anthropic from their profile with their own keys.
    No deployment-wide AI secret is required. Provider/model overrides are optional.
    https://platform.openai.com/api-keys
    https://aistudio.google.com/apikey
    https://console.anthropic.com/
  Template library: SEED_TEMPLATE_MANIFEST / SEED_TEMPLATES_FROM; review content rights.

OIDC authenticates accounts, not site admins. New accounts are non-admin; grant roles explicitly.
Existing accounts are never linked by matching username/email. See README for operator migration.
`;

/** Local configuration checks only: never contacts connectors or prints secret values. */
export function deploymentIssues(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  const prod = env.MODE === "prod";
  if (env.MODE !== "dev" && !prod) issues.push("MODE must be dev or prod");
  try {
    authConfigFromEnv(env);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Invalid authentication configuration");
  }
  if (env.AUTH_MODE === "oidc") {
    for (const key of ["PUBLIC_ORIGIN", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
      if (!env[key]?.trim()) issues.push(`${key} is required for OIDC`);
    }
  }
  try {
    const database = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname || database.pathname.length <= 1) {
      issues.push("DATABASE_URL must identify a PostgreSQL database");
    }
    if (prod && /CHANGE_ME/.test(env.DATABASE_URL ?? "")) issues.push("Replace the DATABASE_URL placeholder");
  } catch {
    issues.push("DATABASE_URL must identify a PostgreSQL database");
  }
  if (prod) {
    if ((env.INTERNAL_TOKEN?.length ?? 0) < 32 || env.INTERNAL_TOKEN === "dev-internal-token") {
      issues.push("INTERNAL_TOKEN must have at least 32 characters in production (generate a random secret)");
    }
    if (env.SEED_SAMPLE === "true") issues.push("SEED_SAMPLE=true is not allowed in production");
    if (env.SEED_STICKERS_FROM) issues.push("SEED_STICKERS_FROM is development-only");
  }
  const storage = env.STORAGE_PROVIDER || "local";
  if (storage === "s3") {
    if (!env.S3_BUCKET?.trim()) issues.push("S3_BUCKET is required for S3 storage");
    if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
      issues.push("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the AWS credential chain");
    }
    if (env.S3_ENDPOINT) {
      try {
        const endpoint = new URL(env.S3_ENDPOINT);
        if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
          issues.push("S3_ENDPOINT must be an HTTP(S) URL without credentials, query or fragment");
        }
      } catch {
        issues.push("S3_ENDPOINT must be a valid HTTP(S) URL");
      }
    }
  } else if (storage === "local") {
    if (prod && !env.LOCAL_STORAGE_DIR?.trim()) issues.push("Set LOCAL_STORAGE_DIR to a durable production volume");
  } else {
    issues.push("STORAGE_PROVIDER must be local or s3");
  }
  if (env.SEARCH_ENABLED && !["true", "false"].includes(env.SEARCH_ENABLED)) issues.push("SEARCH_ENABLED must be true or false");
  try {
    servicePorts(env);
    if (env.WEB_PORT && (!/^\d+$/.test(env.WEB_PORT) || Number(env.WEB_PORT) < 1 || Number(env.WEB_PORT) > 65535)) {
      issues.push("WEB_PORT must be an integer from 1 to 65535");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Invalid service ports");
  }
  return [...new Set(issues)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--options") {
    console.log(OPTIONS);
  } else if (args.length) {
    console.error("usage: ./run.sh <config> deployment [--options]");
    process.exitCode = 2;
  } else {
    console.log("Deployment configuration (local checks only; connector credentials/connectivity are not tested)");
    const issues = deploymentIssues(process.env);
    if (issues.length) {
      for (const issue of issues) console.error(`  Required: ${issue}`);
      console.error("See ./run.sh <config> deployment --options for connector choices and setup links.");
      process.exitCode = 1;
    } else {
      const auth = authConfigFromEnv(process.env);
      console.log(`  Authentication: ${auth.mode === "oidc" ? "OIDC + server-side sessions" : "INSECURE development username login; trusted local use only"}`);
      if (auth.mode === "oidc") console.log(`  Register redirect URI: ${auth.publicOrigin}/api/auth/callback`);
      console.log("  Database: PostgreSQL configured (connection details hidden)");
      console.log(`  Media: ${(process.env.STORAGE_PROVIDER || "local") === "s3" ? "S3-compatible bucket; verify object read/write/delete permissions" : "local files; persist and back up the storage volume"}`);
      console.log(`  Semantic search: ${process.env.SEARCH_ENABLED === "true" ? "enabled; model download and persistent cache required" : "disabled (name/tag search remains available)"}`);
      console.log("  AI: optional, each user supplies their own provider keys in Profile");
      console.log("Configuration checks passed. Verify login, upload and backups before opening access.");
    }
  }
}
