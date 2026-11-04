import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const FILES: Record<string, { name: string; type: string }> = {
  "/": { name: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { name: "index.html", type: "text/html; charset=utf-8" },
  "/MANIFEST.json": { name: "MANIFEST.json", type: "application/json; charset=utf-8" },
  "/REGISTRY_POLICY.json": { name: "REGISTRY_POLICY.json", type: "application/json; charset=utf-8" },
};

const FONTS: Record<string, string> = {
  "/fonts/impact.ttf": "Impact.ttf",
  "/fonts/sans.ttf": "NotoSans-Bold.ttf",
  "/fonts/thin.ttf": "TitilliumWeb-SemiBold.ttf",
  "/fonts/comic.ttf": "Kalam-Regular.ttf",
};
const FONT_HELP = "Run ./run.sh config/dev.env library download and set SEED_TEMPLATES_FROM to that checkout.";

function buildPreview(): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const child = spawn("bun", ["build", fileURLToPath(new URL("preview.ts", import.meta.url)), "--target=browser", "--format=esm"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.on("error", (error) => reject(new Error(`Unable to build caption preview: ${error.message}`)));
  child.on("close", (code, signal) => {
    if (code !== 0) {
      reject(new Error(`Caption preview build failed (${signal ? `signal ${signal}` : `exit ${code}`}); see Bun diagnostics above`));
    } else {
      resolve(Buffer.concat(chunks));
    }
  });
  return promise;
}

async function main(): Promise<void> {
  if (process.env.MODE === "prod") throw new Error("library preview is disabled in prod mode");
  const { values } = parseArgs({ options: { port: { type: "string", default: "8088" } }, allowPositionals: false });
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port!) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535 (0 chooses an available port)");
  }
  // Fail at startup rather than advertise a preview whose directory assets are missing.
  for (const name of ["index.html", "MANIFEST.json", "REGISTRY_POLICY.json"]) {
    if (!(await stat(new URL(name, import.meta.url))).isFile()) throw new Error(`not a file: ${name}`);
  }
  const preview = await buildPreview();
  const checkout = process.env.SEED_TEMPLATES_FROM?.trim();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed\n");
      return;
    }
    const [path = ""] = (request.url ?? "").split("?", 1);
    if (path === "/preview.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Content-Length": preview.byteLength });
      response.end(request.method === "HEAD" ? undefined : preview);
      return;
    }
    const font = Object.hasOwn(FONTS, path) ? FONTS[path] : undefined;
    const file = Object.hasOwn(FILES, path) ? FILES[path] : undefined;
    if (!file && !font) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : "Not found\n");
      return;
    }
    try {
      if (font && !checkout) throw new Error("SEED_TEMPLATES_FROM is not configured");
      const data = await readFile(font ? resolve(checkout!, "fonts", font) : new URL(file!.name, import.meta.url));
      response.writeHead(200, { "Content-Type": font ? "font/ttf" : file!.type, "Content-Length": data.byteLength });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch (error) {
      const message = font ? `Unable to load preview font ${font}. ${FONT_HELP}` : "Unable to read library asset";
      console.error(`library serve: reading ${font ?? file!.name}: ${(error as Error).message}${font ? ` ${FONT_HELP}` : ""}`);
      response.writeHead(font ? 503 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : `${message}\n`);
    }
  });
  server.on("error", (error) => {
    console.error(`library serve: ${error.message}`);
    process.exitCode = 1;
  });
  const shutdown = () => {
    server.close((error) => {
      if (error) {
        console.error(`library serve: shutdown: ${error.message}`);
        process.exitCode = 1;
      }
    });
    server.closeIdleConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string") {
      console.log(`Library preview: http://127.0.0.1:${address.port}/ (Ctrl-C to stop)`);
    }
  });
}

main().catch((error: unknown) => {
  console.error(`library serve: ${(error as Error).message}`);
  process.exitCode = 1;
});
