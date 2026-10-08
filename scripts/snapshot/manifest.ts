/**
 * The snapshot zip format: `manifest.json`, the database (`db/`), and every asset's bytes (`assets/<folder>/`).
 * See ARCH.md, "Snapshots".
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { z } from "zod";

/** Bumped only when the zip layout itself changes; schema changes are carried by `migrations`. */
export const SNAPSHOT_FORMAT = 1;
export const MANIFEST_PATH = "manifest.json";
/** `pg_dump --format=custom`: schema + data, including `schema_migrations`. What `load` restores. */
export const DUMP_PATH = "db/memegen.dump";
/** `pg_dump --schema-only` as plain SQL, for reading a snapshot's schema without restoring it. Never loaded. */
export const SCHEMA_PATH = "db/schema.sql";

/** Asset folders, in the order an asset with several roles is claimed (each asset is stored once). */
export const ASSET_FOLDERS = ["fonts", "stickers", "templates", "memes", "uploads"] as const;
export type AssetFolder = (typeof ASSET_FOLDERS)[number];

const fileSchema = z.object({
  path: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
});

export const manifestSchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  label: z.string(),
  createdAt: z.iso.datetime(),
  source: z.object({
    mode: z.string().nullable(),
    database: z.string(),
    gitCommit: z.string().nullable(),
    postgres: z.string(),
  }),
  /** `schema_migrations` of the saved database: the schema version. */
  migrations: z.array(z.string()).min(1),
  /** Row count of every table in `public` at save time. */
  counts: z.record(z.string(), z.number().int().nonnegative()),
  db: fileSchema,
  schema: fileSchema,
  assets: z.array(
    fileSchema.extend({
      id: z.uuid(),
      folder: z.enum(ASSET_FOLDERS),
      kind: z.string(),
      mime: z.string(),
      /** Provider-relative key the bytes are stored under; kept on load, whatever the target provider. */
      storageKey: z.string(),
    }),
  ),
});
export type Manifest = z.output<typeof manifestSchema>;
export type ManifestFile = z.output<typeof fileSchema>;

/** Validates manifest JSON, refusing other formats with a message instead of a schema dump. */
export function parseManifest(json: unknown): Manifest {
  const format = json && typeof json === "object" && "format" in json ? json.format : undefined;
  if (format !== SNAPSHOT_FORMAT) {
    throw new Error(`snapshot format ${String(format)} is not supported (this code reads format ${SNAPSHOT_FORMAT})`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new Error(`invalid snapshot manifest: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** `Distracted Boyfriend!` → `distracted-boyfriend`, at most 60 characters. */
export function fileSlug(label: string): string {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

/** Reads a stream to its end, returning its sha256 and length. */
export async function hashStream(stream: Readable | AsyncIterable<Uint8Array>): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk as Uint8Array);
    bytes += (chunk as Uint8Array).byteLength;
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** Runs a PostgreSQL client tool (pg_dump, pg_restore), failing with its stderr. */
export function runPgTool(command: string, args: string[]): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.on("error", (err: NodeJS.ErrnoException) =>
    reject(err.code === "ENOENT" ? new Error(`${command} not found; install the PostgreSQL client tools`) : err),
  );
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code}): ${stderr.trim()}`))));
  return promise;
}
