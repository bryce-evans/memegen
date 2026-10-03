/**
 * Runs migrations, then storage + api (node --watch) and the Vite dev server.
 *   bun run dev
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const node = process.execPath;
// Fallback when not launched via run.sh (which exports the chosen config).
const envFile = "--env-file-if-exists=config/dev.env";

const procs: [string, string, string[], string][] = [
  ["storage", node, [envFile, "--watch", "services/storage/src/server.ts"], root],
  ["api", node, [envFile, "--watch", "services/api/src/server.ts"], root],
  ["web", "bunx", ["vite", "--port", process.env.WEB_PORT ?? "5173", "--strictPort"], `${root}apps/web`],
];

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>();
  spawn(cmd, args, { cwd, stdio: "inherit" }).on("exit", (code) => resolve(code ?? 1));
  return promise;
}

const migrated = await run(node, [envFile, "packages/server-kit/src/migrate.ts"], root);
if (migrated !== 0) process.exit(migrated);

const children: ChildProcess[] = [];
for (const [name, cmd, args, cwd] of procs) {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "1" } });
  const prefix = `[${name}] `;
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) =>
    stream.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line) out.write(prefix + line + "\n");
    });
  pipe(child.stdout!, process.stdout);
  pipe(child.stderr!, process.stderr);
  child.on("exit", (code) => {
    console.error(`${prefix}exited with ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
