/**
 * The processes of a running stack: storage, api and web. Used by scripts/run.ts (dev and prod)
 * and by playwright.config.ts (e2e webServer).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Service {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  /** Port the service listens on once ready. */
  port: number;
}

export interface StackOptions {
  /** Restart the servers on change (`node --watch`). */
  watch: boolean;
  /** `vite`: the dev server; `dist`: scripts/serve-web.ts serving the built app. */
  web: "vite" | "dist";
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function services({ watch, web }: StackOptions, env: NodeJS.ProcessEnv = process.env): Service[] {
  const server = (name: string, port: string): Service => ({
    name,
    command: "node",
    args: [...(watch ? ["--watch"] : []), `services/${name}/src/server.ts`],
    cwd: ROOT,
    port: Number(port),
  });
  const webPort = env.WEB_PORT || (web === "vite" ? "5173" : "8080");
  return [
    server("storage", env.STORAGE_PORT || "4001"),
    server("api", env.API_PORT || "4000"),
    web === "vite"
      ? { name: "web", command: "bunx", args: ["vite", "--port", webPort, "--strictPort"], cwd: join(ROOT, "apps/web"), port: Number(webPort) }
      : { name: "web", command: "node", args: ["scripts/serve-web.ts"], cwd: ROOT, port: Number(webPort) },
  ];
}
