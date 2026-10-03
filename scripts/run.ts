/**
 * Runs migrations, then storage + api + web (scripts/services.ts) with each output line prefixed by
 * its process. When any process exits, or on Ctrl-C/SIGTERM, the rest are stopped; the exit status
 * is that of the process that stopped first (0 when stopped by a signal).
 *
 *   node scripts/run.ts --watch   # dev: servers under node --watch, Vite dev server
 *   node scripts/run.ts --prod    # built app (apps/web/dist) via scripts/serve-web.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { services } from "./services.ts";

const { values } = parseArgs({ options: { watch: { type: "boolean" }, prod: { type: "boolean" } } });
if (Boolean(values.watch) === Boolean(values.prod)) {
  console.error("usage: node scripts/run.ts --watch | --prod");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const migrate = spawn("node", ["packages/server-kit/src/migrate.ts"], { cwd: root, stdio: "inherit" });
const migrated = await new Promise<number>((resolve) => migrate.on("exit", (code) => resolve(code ?? 1)));
if (migrated !== 0) process.exit(migrated);

const children: ChildProcess[] = [];
let stopped = false;

function stopAll(status: number): void {
  if (stopped) return;
  stopped = true;
  process.exitCode = status;
  for (const child of children) child.kill("SIGTERM");
  // Node exits by itself once every child is gone; force anything that ignores SIGTERM.
  setTimeout(() => children.forEach((child) => child.kill("SIGKILL")), 5_000).unref();
}

function prefixLines(input: Readable, out: NodeJS.WriteStream, prefix: string): void {
  createInterface({ input, crlfDelay: Infinity }).on("line", (line) => out.write(prefix + line + "\n"));
}

// Children write to pipes; keep their colors unless the user opted out.
const childEnv = process.env.NO_COLOR ? process.env : { ...process.env, FORCE_COLOR: "1" };
for (const s of services({ watch: Boolean(values.watch), web: values.watch ? "vite" : "dist" })) {
  const child = spawn(s.command, s.args, { cwd: s.cwd, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
  const prefix = `[${s.name}] `;
  prefixLines(child.stdout!, process.stdout, prefix);
  prefixLines(child.stderr!, process.stderr, prefix);
  child.on("exit", (code, signal) => {
    if (stopped) return;
    console.error(`${prefix}exited (${signal ?? code}); stopping the rest`);
    stopAll(code ?? 1);
  });
  child.on("error", (err) => {
    console.error(`${prefix}${err.message}`);
    stopAll(1);
  });
  children.push(child);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
