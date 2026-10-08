import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { openPromise, type Entry, type ZipFile } from "yauzl";
import { migrate, migrationFiles, MIGRATIONS_DIR, type Sql } from "@memegen/server-kit";
import type { Providers } from "@memegen/storage";
import { hashStream, MANIFEST_PATH, parseManifest, runPgTool, type Manifest } from "./manifest.ts";

export interface LoadOptions {
  /** The database `sql` is connected to; pg_restore connects to it separately. */
  databaseUrl: string;
  /** Asset bytes go to `providers.default`. */
  providers: Providers;
  file: string;
  migrationsDir?: string;
}

export interface LoadResult {
  manifest: Manifest;
  /** Migrations newer than the snapshot, applied after the restore. */
  migrated: string[];
}

async function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * A target is clean when it has no tables, or only what migrations create on their own: no users and no assets,
 * so it holds no content (every template, meme, sticker, and user-made tag hangs off one of them). A migrated
 * but empty database (e.g. after `setup`) is reset to an empty schema; anything else is refused.
 */
async function prepareTarget(sql: Sql): Promise<void> {
  const tables = (await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename);
  if (tables.length === 0) return;
  const empty =
    tables.includes("users") &&
    tables.includes("assets") &&
    !(await sql`select 1 from users limit 1`).length &&
    !(await sql`select 1 from assets limit 1`).length;
  if (!empty) {
    throw new Error("the target database has data; a snapshot loads only into a clean system (dev: `snapshot load <zip> --replace`)");
  }
  await sql.begin(async (tx) => {
    await tx`drop schema public cascade`;
    await tx`create schema public`;
  });
}

/**
 * Loads a snapshot into a clean system: verifies every file in the zip, uploads the asset bytes to the default
 * provider, restores the database dump as it was saved, then migrates it forward to the current schema.
 */
export async function loadSnapshot(sql: Sql, opts: LoadOptions): Promise<LoadResult> {
  const zip = await openPromise(opts.file, { lazyEntries: true, autoClose: false });
  const work = await mkdtemp(join(tmpdir(), "memegen-snapshot-"));
  try {
    const entries = new Map<string, Entry>();
    for await (const entry of zip.eachEntry()) {
      if (entries.has(entry.fileName)) throw new Error(`snapshot has ${entry.fileName} twice`);
      entries.set(entry.fileName, entry);
    }
    const entryFor = (path: string): Entry => {
      const entry = entries.get(path);
      if (!entry) throw new Error(`snapshot is missing ${path}`);
      return entry;
    };
    const manifest = parseManifest(JSON.parse((await readEntry(zip, entryFor(MANIFEST_PATH))).toString("utf8")));

    // Nothing is written until the whole zip checks out.
    const known = new Set(await migrationFiles(opts.migrationsDir ?? MIGRATIONS_DIR));
    const unknown = manifest.migrations.filter((m) => !known.has(m));
    if (unknown.length) {
      throw new Error(`the snapshot was saved by newer code (migrations ${unknown.join(", ")} are not in db/migrations); update the code first`);
    }
    for (const file of [manifest.db, manifest.schema, ...manifest.assets]) {
      const actual = await hashStream(await zip.openReadStreamPromise(entryFor(file.path)));
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) throw new Error(`${file.path} is corrupt (sha256 or size mismatch)`);
    }
    await prepareTarget(sql);

    // Bytes first: if an upload fails, the database is still untouched. Keys are unique per asset id.
    const provider = opts.providers.default;
    for (const a of manifest.assets) await provider.put(a.storageKey, await readEntry(zip, entryFor(a.path)), a.mime);

    const dumpFile = join(work, "memegen.dump");
    await pipeline(await zip.openReadStreamPromise(entryFor(manifest.db.path)), createWriteStream(dumpFile));
    await runPgTool("pg_restore", ["--no-owner", "--no-acl", "--single-transaction", "--exit-on-error", `--dbname=${opts.databaseUrl}`, dumpFile]);
    await sql`update assets set provider = ${provider.name} where provider <> ${provider.name}`;

    const mismatched: string[] = [];
    for (const [table, expected] of Object.entries(manifest.counts)) {
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
      if (row!.n !== expected) mismatched.push(`${table}: ${row!.n} rows, snapshot has ${expected}`);
    }
    if (mismatched.length) throw new Error(`restored row counts differ from the snapshot:\n  ${mismatched.join("\n  ")}`);

    const migrated = await migrate(sql, opts.migrationsDir ?? MIGRATIONS_DIR);
    return { manifest, migrated };
  } finally {
    zip.close();
    await rm(work, { recursive: true, force: true });
  }
}
