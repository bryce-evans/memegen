import { writeFileSync } from "node:fs";
import type { FullConfig, Reporter, Suite, TestError } from "@playwright/test/reporter";

/** The two-config runner tolerates an empty suite, but never an empty combined selection. */
export default class CountReporter implements Reporter {
  onBegin(_config: FullConfig, suite: Suite): void {
    const path = process.env.MEMEGEN_E2E_COUNT_FILE;
    if (!path) throw new Error("test-count reporter requires the e2e runner");
    writeFileSync(path, String(suite.allTests().length));
  }

  onError(error: TestError): void {
    console.error(error.stack ?? error.message ?? String(error));
  }
}
