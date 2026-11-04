import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Playwright webServer/globalSetup are configuration-wide, not project-scoped.
// Keep the read-only gallery independent while the standard command still runs both suites.
const args: string[] = [];
const projects = new Set<string>();
let reporter = process.env.CI ? "list,html" : "list";
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (arg === "--project" || arg.startsWith("--project=")) {
    const project = arg === "--project" ? process.argv[++i] : arg.slice("--project=".length);
    if (project !== "library" && project !== "chrome") throw new Error("--project must be library or chrome");
    projects.add(project);
  } else if (arg === "--reporter" || arg.startsWith("--reporter=")) {
    reporter = (arg === "--reporter" ? process.argv[++i] : arg.slice("--reporter=".length)) ?? "";
    if (!reporter) throw new Error("--reporter requires a value");
  } else {
    args.push(arg);
  }
}
const listArgs: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--ui-host" || arg === "--ui-port") i++;
  else if (arg !== "--ui" && arg !== "--debug" && !arg.startsWith("--ui-host=") && !arg.startsWith("--ui-port=")) listArgs.push(arg);
}
const dir = mkdtempSync(join(tmpdir(), "memegen-e2e-"));
const countFile = join(dir, "selected-tests");
let selected = 0;
let status = 0;
try {
  for (const [project, config] of [["library", "playwright.library.config.ts"], ["chrome", "playwright.config.ts"]] as const) {
    if (projects.size && !projects.has(project)) continue;
    writeFileSync(countFile, "0");
    const env = {
      ...process.env,
      MEMEGEN_E2E_COUNT_FILE: countFile,
      PLAYWRIGHT_HTML_OUTPUT_DIR: join(process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? "playwright-report", project),
    };
    // Normal Playwright runs start global setup before finding tests. Listing first is essential:
    // a gallery-only file/grep filter must not start or reset the app stack.
    const listing = spawnSync("bunx", ["playwright", "test", "--config", config, ...listArgs,
      "--list", "--reporter", "./e2e/count-reporter.ts",
      ...(projects.size === 0 ? ["--pass-with-no-tests"] : []),
    ], { stdio: "inherit", env });
    if (listing.error) throw listing.error;
    if (listing.status !== 0) {
      status = listing.status ?? 1;
      break;
    }
    const count = Number(readFileSync(countFile, "utf8"));
    selected += count;
    if (count === 0) continue;
    const result = spawnSync("bunx", ["playwright", "test", "--config", config, ...args,
      "--reporter", reporter,
    ], { stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      status = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (status === 0 && selected === 0 && !args.includes("--help") && !args.includes("-h")) {
  console.error("No tests found in either browser suite.");
  status = 1;
}
process.exitCode = status;
