import { execFileSync } from "node:child_process";
import { E2E_ENV } from "../playwright.config.ts";

export default function globalSetup() {
  execFileSync(process.execPath, ["e2e/setup-db.ts"], { env: { ...process.env, ...E2E_ENV }, stdio: "inherit" });
}
