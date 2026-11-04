/**
 * The processes of a running stack: storage, api, web, and (with `SEARCH_ENABLED=true`) the search sidecar. Used by
 * scripts/run.ts (dev and prod) and by playwright.config.ts (e2e webServer).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { portFromEnv, servicePorts } from "@memegen/server-kit/ports";

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
  const ports = servicePorts(env);
  const webPort = portFromEnv(env, "WEB_PORT", web === "vite" ? 5173 : 8080);
  return [
    server("storage", ports.storage),
    server("api", ports.api),
    ...(env.SEARCH_ENABLED === "true" ? [server("search", ports.search)] : []),
    web === "vite"
      ? { name: "web", command: "bunx", args: ["vite", "--port", String(webPort), "--strictPort"], cwd: join(ROOT, "apps/web"), port: webPort }
      : { name: "web", command: "node", args: ["scripts/serve-web.ts"], cwd: ROOT, port: webPort },
  ];
}
