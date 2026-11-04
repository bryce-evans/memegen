import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { services } from "./services.ts";

test("topology uses only its supplied environment even when caller ports are invalid", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { services } from './scripts/services.ts';
    console.log(JSON.stringify(services({ watch: false, web: 'vite' }, { SEARCH_ENABLED: 'true' }).map(s => [s.name, s.port])));
  `], { encoding: "utf8", env: { ...process.env, API_PORT: "bad", STORAGE_PORT: "bad", SEARCH_PORT: "bad", WEB_PORT: "bad" } });
  assert.deepEqual(JSON.parse(output), [["storage", 4001], ["api", 4000], ["search", 4002], ["web", 5173]]);
});

test("topology honors isolated service ports and production web defaults", () => {
  const isolated = services({ watch: false, web: "vite" }, { API_PORT: "4100", STORAGE_PORT: "4101", SEARCH_PORT: "4103", WEB_PORT: "5174", SEARCH_ENABLED: "true" });
  assert.deepEqual(isolated.map(({ name, port }) => [name, port]), [["storage", 4101], ["api", 4100], ["search", 4103], ["web", 5174]]);
  assert.deepEqual(isolated.at(-1)!.args, ["vite", "--port", "5174", "--strictPort"]);
  assert.deepEqual(services({ watch: false, web: "dist" }, {}).map(({ name, port }) => [name, port]), [["storage", 4001], ["api", 4000], ["web", 8080]]);
});

test("invalid listener ports are rejected instead of silently selecting another stack", () => {
  for (const key of ["API_PORT", "STORAGE_PORT", "SEARCH_PORT", "WEB_PORT"]) {
    for (const value of ["0", "-1", "1.5", "65536", "NaN"]) {
      assert.throws(() => services({ watch: false, web: "vite" }, { [key]: value }), new RegExp(key));
    }
  }
});
