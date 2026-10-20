/**
 * The processes of a running stack: storage, api, web, and (with `SEARCH_ENABLED=true`) the search sidecar. Used by
 * scripts/run.ts (dev and prod) and by playwright.config.ts (e2e webServer).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, searchConfig } from "@memegen/server-kit";

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
  const server = (name: string, port: number): Service => ({
    name,
    command: "node",
    args: [...(watch ? ["--watch"] : []), `services/${name}/src/server.ts`],
    cwd: ROOT,
    port,
  });
  const webPort = env.WEB_PORT || (web === "vite" ? "5173" : "8080");
  return [
    // `env` (e2e passes its own) wins over the config defaults read from process.env.
    server("storage", Number(env.STORAGE_PORT) || config.storagePort),
    server("api", Number(env.API_PORT) || config.apiPort),
    ...(env.SEARCH_ENABLED === "true" ? [server("search", Number(env.SEARCH_PORT) || searchConfig.port)] : []),
    web === "vite"
      ? { name: "web", command: "bunx", args: ["vite", "--port", webPort, "--strictPort"], cwd: join(ROOT, "apps/web"), port: Number(webPort) }
      : { name: "web", command: "node", args: ["scripts/serve-web.ts"], cwd: ROOT, port: Number(webPort) },
  ];
}
