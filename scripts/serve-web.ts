/**
 * Production web server: serves the built SPA (apps/web/dist) and proxies
 * /api → API_URL and /storage → STORAGE_URL (prefix stripped), mirroring the Vite dev proxy.
 * /internal is never proxied.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));
const PORT = Number(process.env.WEB_PORT ?? 8080);
const API_URL = new URL(process.env.API_URL ?? "http://localhost:4000");
const STORAGE_URL = new URL(process.env.STORAGE_URL ?? "http://localhost:4001");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function proxy(req: IncomingMessage, res: ServerResponse, target: URL, path: string): void {
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path,
      headers: { ...req.headers, host: target.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream unavailable" }));
  });
  req.pipe(upstream);
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) {
    res.writeHead(400).end();
    return;
  }
  const info = await stat(file).catch(() => null);
  const isAsset = rel.startsWith("assets/");
  if (!info?.isFile()) {
    if (isAsset || extname(rel)) {
      res.writeHead(404).end("not found");
      return;
    }
    file = join(DIST, "index.html"); // SPA route
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    // Vite fingerprints everything under assets/; index.html must always revalidate.
    "cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/api" || url.startsWith("/api/")) return proxy(req, res, API_URL, url);
  if (url === "/storage" || url.startsWith("/storage/")) return proxy(req, res, STORAGE_URL, url.slice("/storage".length) || "/");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  void serveStatic(res, new URL(url, "http://x").pathname);
});

if (!(await stat(join(DIST, "index.html")).catch(() => null))) {
  console.error(`missing ${DIST}index.html; build first (bun run build)`);
  process.exit(1);
}
server.listen(PORT, () => console.log(`web listening on :${PORT} (api ${API_URL.origin}, storage ${STORAGE_URL.origin})`));
