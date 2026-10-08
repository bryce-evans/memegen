/**
 * Saves or loads a snapshot: the whole database plus every asset's bytes, in one zip (see ARCH.md, "Snapshots").
 *
 *   ./run.sh <config> snapshot save [out.zip] [--label backup]
 *   ./run.sh <config> snapshot load <in.zip> [--replace]   (--replace is handled by run.sh, dev only)
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { config, createSql } from "@memegen/server-kit";
import { createProviders } from "@memegen/storage";
import { loadSnapshot } from "./snapshot/load.ts";
import { saveSnapshot } from "./snapshot/save.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { label: { type: "string", default: "backup" } },
});
const [command, path] = positionals;
const usage = "usage: snapshot save [out.zip] [--label <name>] | snapshot load <in.zip>";

const sql = createSql();
try {
  const providers = createProviders(process.env.STORAGE_PROVIDER || "local");
  const databaseUrl = config.databaseUrl;
  if (command === "save") {
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
    const out = resolve(path ?? `.data/snapshots/memegen-${values.label}-${stamp}.zip`);
    const m = await saveSnapshot(sql, { databaseUrl, providers, out, label: values.label });
    const bytes = m.assets.reduce((sum, a) => sum + a.bytes, 0);
    console.log(`saved ${out}`);
    console.log(`  ${m.migrations.length} migrations, ${m.assets.length} assets (${(bytes / 1e6).toFixed(1)} MB)`);
    console.log(`  ${Object.entries(m.counts).map(([t, n]) => `${t} ${n}`).join(", ")}`);
  } else if (command === "load" && path) {
    const { manifest: m, migrated } = await loadSnapshot(sql, { databaseUrl, providers, file: resolve(path) });
    console.log(`loaded ${path} (${m.label}, saved ${m.createdAt} from ${m.source.database}${m.source.gitCommit ? ` @ ${m.source.gitCommit}` : ""})`);
    console.log(`  ${m.assets.length} assets into ${providers.default.name} storage`);
    console.log(`  ${Object.entries(m.counts).map(([t, n]) => `${t} ${n}`).join(", ")}`);
    console.log(migrated.length ? `  migrated forward: ${migrated.join(", ")}` : "  schema already current");
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`snapshot ${command}: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
