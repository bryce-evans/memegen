import { test, expect } from "@playwright/test";

export { expect, test };

/**
 * Suffixed with the Playwright project name. Every spec (and every project, should one be added) runs against the same
 * seeded DB, so base names must already be distinct across specs; the suffix keeps them distinct across projects too.
 */
export function scoped(name: string): string {
  return `${name}-${test.info().project.name}`;
}
