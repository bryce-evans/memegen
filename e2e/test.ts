import { test, expect } from "@playwright/test";

export { expect, test };

/** Suffixed with the Playwright project name, so projects (e.g. `--project` variants) can share one seeded database. */
export function scoped(name: string): string {
  return `${name}-${test.info().project.name}`;
}
