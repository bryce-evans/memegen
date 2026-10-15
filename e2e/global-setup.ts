import { execFileSync } from "node:child_process";
import { startAiStub } from "@memegen/server-kit/testing";
import { AI_STUB_PORT, E2E_ENV } from "../playwright.config.ts";

/** Fresh database, and the AI provider stub the API's `OPENAI_BASE_URL`/`GEMINI_BASE_URL` point at for the run. */
export default async function globalSetup() {
  execFileSync(process.execPath, ["e2e/setup-db.ts"], { env: { ...process.env, ...E2E_ENV }, stdio: "inherit" });
  const stub = await startAiStub(AI_STUB_PORT);
  return () => stub.close();
}
