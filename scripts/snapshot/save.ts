import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { migrationFiles, MIGRATIONS_DIR, type Sql } from "@memegen/server-kit";
import type { Providers } from "@memegen/storage";
import {
  DUMP_PATH,
  fileSlug,
  hashStream,
  MANIFEST_PATH,
  runPgTool,
  SCHEMA_PATH,
  SNAPSHOT_FORMAT,
  type AssetFolder,
  type Manifest,
  type ManifestFile,
} from "./manifest.ts";

export interface SaveOptions {
  /** The database `sql` is connected to; pg_dump connects to it separately. */
  databaseUrl: string;
  providers: Providers;
  out: string;
  label: string;
  /** Migrations the database must be at (all applied, none unknown). */
  migrationsDir?: string;
}

interface AssetSource {
  id: string;
  kind: string;
  mime: string;
  sha256: string;
  provider: string;
  storage_key: string;
  name: string;
  sticker: string | null;
  template: string | null;
  pack: string | null;
  meme: string | null;
}

/** Each asset's role decides its folder; the label names its file. */
function placeAsset(a: AssetSource): { folder: AssetFolder; label: string } {
  if (a.kind === "font") return { folder: "fonts", label: a.name };
  if (a.sticker !== null) return { folder: "stickers", label: a.sticker };
  if (a.template !== null || a.pack !== null) return { folder: "templates", label: (a.template ?? a.pack)! };
  if (a.meme !== null) return { folder: "memes", label: a.meme };
  return { folder: "uploads", label: a.name };
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Writes a snapshot zip of the whole database and every asset's bytes. Read-only on the source: the dump and
 * the asset list come from one exported Postgres snapshot, so they describe the same moment on a live system.
 * Fails, leaving no zip, if any asset's bytes are missing or don't match their recorded sha256.
 */
export async function saveSnapshot(sql: Sql, opts: SaveOptions): Promise<Manifest> {
  const expected = await migrationFiles(opts.migrationsDir ?? MIGRATIONS_DIR);
  const work = await mkdtemp(join(tmpdir(), "memegen-snapshot-"));
  const dumpFile = join(work, "memegen.dump");
  const schemaFile = join(work, "schema.sql");
  try {
    const { migrations, counts, assets, postgres } = await sql.begin("isolation level repeatable read read only", async (tx) => {
      const [hasMigrations] = await tx`select 1 from pg_tables where schemaname = 'public' and tablename = 'schema_migrations'`;
      const migrations = hasMigrations ? (await tx<{ name: string }[]>`select name from schema_migrations order by name`).map((r) => r.name) : [];
      if (migrations.join("\n") !== expected.join("\n")) {
        throw new Error(
          `database migrations don't match db/migrations (database has ${migrations.length}, code has ${expected.length}); ` +
            "run `./run.sh <config> migrate` with matching code first",
        );
      }
      const [exported] = await tx<{ snapshot: string }[]>`select pg_export_snapshot() as snapshot`;
      const dumpArgs = ["--no-owner", "--no-acl", `--snapshot=${exported!.snapshot}`, `--dbname=${opts.databaseUrl}`];
      // Both dumps run while this transaction holds the snapshot open.
      await Promise.all([
        runPgTool("pg_dump", ["--format=custom", `--file=${dumpFile}`, ...dumpArgs]),
        runPgTool("pg_dump", ["--format=plain", "--schema-only", `--file=${schemaFile}`, ...dumpArgs]),
      ]);
      const counts: Record<string, number> = {};
      for (const { tablename } of await tx<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' order by 1`) {
        const [row] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(tablename)}`;
        counts[tablename] = row!.n;
      }
      const assets = await tx<AssetSource[]>`
        select a.id, a.kind, a.mime, a.sha256, a.provider, a.storage_key, a.name,
          (select s.name from stickers s where s.asset_id = a.id) as sticker,
          (select t.name from templates t where t.asset_id = a.id order by t.created_at limit 1) as template,
          (select t.name || ' pack ' || (p.position + 1)
             from template_pack_assets p join templates t on t.id = p.template_id
             where p.asset_id = a.id order by t.created_at limit 1) as pack,
          (select u.username || ' ' || m.title from memes m join users u on u.id = m.owner_id
             where m.output_asset_id = a.id order by m.created_at limit 1) as meme
        from assets a order by a.created_at, a.id`;
      const [version] = await tx<{ server_version: string }[]>`show server_version`;
      return { migrations, counts, assets, postgres: version!.server_version };
    });

    const zip = new ZipFile();
    const partial = `${opts.out}.partial`;
    await mkdir(dirname(opts.out), { recursive: true });
    const written = pipeline(zip.outputStream, createWriteStream(partial));
    const zipFailed = new Promise<never>((_, reject) => zip.on("error", reject));

    const fileEntry = async (path: string, file: string): Promise<ManifestFile> => ({ path, ...(await hashStream(createReadStream(file))) });
    const db = await fileEntry(DUMP_PATH, dumpFile);
    const schema = await fileEntry(SCHEMA_PATH, schemaFile);
    zip.addFile(dumpFile, DUMP_PATH, { compress: false }); // custom-format dumps are compressed already
    zip.addFile(schemaFile, SCHEMA_PATH);

    const problems: string[] = [];
    const used = new Set<string>();
    const entries: Manifest["assets"] = [];
    for (const a of assets) {
      const { folder, label } = placeAsset(a);
      const ext = extname(a.storage_key);
      const slug = fileSlug(label) || a.kind;
      let path = `assets/${folder}/${slug}--${a.id.slice(0, 8)}${ext}`;
      if (used.has(path)) path = `assets/${folder}/${slug}--${a.id}${ext}`;
      used.add(path);
      const entry = { id: a.id, path, folder, kind: a.kind, mime: a.mime, storageKey: a.storage_key, sha256: a.sha256, bytes: 0 };
      entries.push(entry);
      // Opened only when the zip reaches this entry, so one object is open at a time. Problems are collected
      // rather than thrown, so one run reports every missing or corrupt asset.
      zip.addReadStreamLazy(path, { compress: false }, (cb) => cb(null, Readable.from(assetBytes(a, entry))));
    }

    /** The asset's bytes, hashed as they stream into the zip; records the size and any problem on the way. */
    async function* assetBytes(a: AssetSource, entry: { bytes: number }): AsyncGenerator<Uint8Array> {
      let object;
      try {
        object = await opts.providers.get(a.provider).get(a.storage_key);
      } catch (err) {
        problems.push(`${a.id} (${a.provider}:${a.storage_key}): ${(err as Error).message}`);
        return;
      }
      const hash = createHash("sha256");
      for await (const chunk of object.body) {
        hash.update(chunk);
        entry.bytes += chunk.byteLength;
        yield chunk;
      }
      const sha256 = hash.digest("hex");
      if (sha256 !== a.sha256) problems.push(`${a.id} (${a.provider}:${a.storage_key}): sha256 ${sha256}, expected ${a.sha256}`);
    }

    const manifest: Manifest = {
      format: SNAPSHOT_FORMAT,
      label: opts.label,
      createdAt: new Date().toISOString(),
      source: {
        mode: process.env.MODE ?? null,
        database: new URL(opts.databaseUrl).pathname.slice(1),
        gitCommit: gitCommit(),
        postgres,
      },
      migrations,
      counts,
      db,
      schema,
      assets: entries,
    };
    zip.addReadStreamLazy(MANIFEST_PATH, (cb) => cb(null, Readable.from([JSON.stringify(manifest, null, 2)])));
    zip.end();
    await Promise.race([written, zipFailed]);

    if (problems.length) {
      await rm(partial, { force: true });
      throw new Error(`${problems.length} asset(s) could not be saved:\n  ${problems.join("\n  ")}`);
    }
    await rename(partial, opts.out);
    return manifest;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
