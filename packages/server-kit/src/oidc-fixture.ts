import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

export interface OidcFixture {
  issuer: string;
  clientId: string;
  clientSecret: string;
  controls: { subject: string; username: string; nonce: string | null; invalidSignature: boolean; expired: boolean };
  close(): Promise<void>;
}
/** Test-only real HTTP OIDC issuer. Never selected by application configuration or runtime imports. */
export async function startOidcFixture(): Promise<OidcFixture> {
  if (process.env.MODE !== "dev") throw new Error("OIDC fixture requires MODE=dev");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture-key", use: "sig", alg: "RS256" };
  const clientId = "memegen-fixture";
  const clientSecret = "fixture-only-secret";
  const controls = { subject: "fixture-user", username: "alice", nonce: null as string | null, invalidSignature: false, expired: false };
  const codes = new Map<string, { redirect: string; challenge: string; nonce: string; expires: number }>();
  let issuer = "";
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, issuer);
      const json = (body: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"], code_challenge_methods_supported: ["S256"] });
      } else if (url.pathname === "/jwks") {
        json({ keys: [jwk] });
      } else if (url.pathname === "/authorize") {
        const p = url.searchParams;
        const redirect = new URL(p.get("redirect_uri")!);
        if (p.get("client_id") !== clientId || p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" ||
          !p.get("nonce") || !p.get("state") || !p.get("code_challenge") ||
          !["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname) || redirect.pathname !== "/api/auth/callback") {
          json({ error: "invalid_request" }, 400); return;
        }
        const code = randomBytes(32).toString("base64url");
        codes.set(code, { redirect: redirect.href, challenge: p.get("code_challenge")!, nonce: p.get("nonce")!, expires: Date.now() + 60000 });
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", p.get("state")!);
        redirect.searchParams.set("iss", issuer);
        res.writeHead(302, { location: redirect.href }); res.end();
      } else if (url.pathname === "/token" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const p = new URLSearchParams(Buffer.concat(chunks).toString());
        const code = p.get("code") ?? "";
        const transaction = codes.get(code);
        codes.delete(code);
        if (!transaction || transaction.expires <= Date.now() || p.get("grant_type") !== "authorization_code" ||
          p.get("client_id") !== clientId || p.get("client_secret") !== clientSecret || p.get("redirect_uri") !== transaction.redirect ||
          createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") !== transaction.challenge) {
          json({ error: "invalid_grant" }, 400); return;
        }
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: controls.subject, aud: clientId, iat: now,
          exp: controls.expired ? now - 3600 : now + 300, nonce: controls.nonce ?? transaction.nonce,
          preferred_username: controls.username, email: `${controls.username}@example.test`, email_verified: true,
        })).toString("base64url");
        const input = `${header}.${payload}`;
        const signature = controls.invalidSignature ? randomBytes(256) : sign("RSA-SHA256", Buffer.from(input), privateKey);
        json({ access_token: randomBytes(32).toString("base64url"), token_type: "Bearer", expires_in: 300,
          id_token: `${input}.${signature.toString("base64url")}` });
      } else json({ error: "not_found" }, 404);
    } catch { res.writeHead(400); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { issuer, clientId, clientSecret, controls, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startOidcFixture();
  console.log(`OIDC_ISSUER_URL=${fixture.issuer}\nOIDC_CLIENT_ID=${fixture.clientId}\nOIDC_CLIENT_SECRET=${fixture.clientSecret}`);
}
