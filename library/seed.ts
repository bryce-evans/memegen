import { parseArgs } from "node:util";
import { createSql, migrate } from "@memegen/server-kit";
import { importCheckout } from "./import-checkout.ts";
import { importManifest } from "./import-manifest.ts";
import { loadRegistry, reconcileRegistry } from "./registry.ts";

const { values } = parseArgs({
  options: { from: { type: "string" }, manifest: { type: "string" }, limit: { type: "string" } },
});
const limit = values.limit === undefined ? Infinity : Number(values.limit);
if (values.limit !== undefined && (!/^\d+$/.test(values.limit) || !Number.isSafeInteger(limit))) {
  throw new Error("--limit must be a non-negative safe integer");
}
const checkout = values.from ?? process.env.SEED_TEMPLATES_FROM ?? "";
const manifest = values.manifest ?? process.env.SEED_TEMPLATE_MANIFEST ?? "library/MANIFEST.json";
// Disabling both sources historically skips catalog reconciliation, not schema migration.
const registry = checkout || manifest ? await loadRegistry({ manifest, checkoutEnabled: !!checkout }) : undefined;
const sql = createSql();
try {
  await migrate(sql);
  if (registry) {
    try {
      await reconcileRegistry(sql, registry);
      if (checkout) await importCheckout(sql, registry, checkout, limit);
      if (manifest) await importManifest(sql, registry, limit);
    } finally {
      // Partial imports remain resumable and risk/alias policy is enforced even on failure.
      await reconcileRegistry(sql, registry);
    }
  }
} finally {
  await sql.end();
}
