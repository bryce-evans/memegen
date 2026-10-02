import { createHash } from "node:crypto";
import { limitViolations, type Asset, type AssetKind, type Page, type UploadLimits } from "@memegen/shared";
import { HttpError, type Sql } from "@memegen/server-kit";
import { probe, ProbeError } from "./probe.ts";
import type { Providers } from "./providers/registry.ts";
import type { ByteRange, StoredObject } from "./providers/types.ts";
import { sniff } from "./sniff.ts";

export interface AssetRow {
  id: string;
  kind: AssetKind;
  mime: string;
  name: string;
  filename: string;
  size_bytes: string | number;
  provider: string;
  storage_key: string;
  owner_id: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  frame_count: number | null;
  fps: number | null;
  /** Date from a direct select, string when nested via row_to_json. */
  created_at: Date | string;
}

export function toAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    kind: r.kind,
    mime: r.mime,
    name: r.name,
    filename: r.filename,
    sizeBytes: Number(r.size_bytes),
    provider: r.provider,
    ownerId: r.owner_id,
    width: r.width,
    height: r.height,
    durationMs: r.duration_ms,
    frameCount: r.frame_count,
    fps: r.fps,
    createdAt: new Date(r.created_at).toISOString(),
    contentPath: `/assets/${r.id}/content`,
  };
}

export async function findAssetRow(sql: Sql, id: string): Promise<AssetRow | null> {
  const [row] = await sql<AssetRow[]>`select * from assets where id = ${id}`;
  return row ?? null;
}

export interface UploadInput {
  data: Uint8Array;
  filename: string;
  name?: string;
  ownerId: string | null;
}

/** Asset metadata in Postgres + bytes in a provider. Enforces upload caps on every write. */
export class AssetStore {
  readonly sql: Sql;
  readonly providers: Providers;
  readonly limits: UploadLimits;

  constructor(sql: Sql, providers: Providers, limits: UploadLimits) {
    this.sql = sql;
    this.providers = providers;
    this.limits = limits;
  }

  async upload({ data, filename, name, ownerId }: UploadInput): Promise<Asset> {
    if (data.byteLength > this.limits.maxBytes) {
      throw new HttpError(413, "file too large", limitViolations(data.byteLength, null, this.limits));
    }
    const type = sniff(data);
    if (!type) throw new HttpError(415, "unsupported file type; expected png/jpeg/webp/gif/mp4/mov or ttf/otf/woff");
    let info;
    try {
      info = await probe(type.kind, data);
    } catch (err) {
      if (err instanceof ProbeError) throw new HttpError(422, err.message);
      throw err;
    }
    const violations =
      type.kind === "font"
        ? limitViolations(data.byteLength, null, this.limits)
        : limitViolations(
            data.byteLength,
            { kind: type.kind, width: info.width!, height: info.height!, frameCount: info.frameCount },
            this.limits,
          );
    if (violations.length) throw new HttpError(422, "file exceeds upload limits", violations);

    const id = crypto.randomUUID();
    const provider = this.providers.default;
    const key = `${type.kind}/${id.slice(0, 2)}/${id}${type.ext}`;
    const sha256 = createHash("sha256").update(data).digest("hex");
    const cleanName = (name ?? filename.replace(/\.[^.]+$/, "")).trim().slice(0, 200) || type.kind;
    await provider.put(key, data, type.mime);
    try {
      const [row] = await this.sql<AssetRow[]>`
        insert into assets ${this.sql({
          id,
          kind: type.kind,
          mime: type.mime,
          name: cleanName,
          filename: filename.slice(0, 255),
          size_bytes: data.byteLength,
          sha256,
          provider: provider.name,
          storage_key: key,
          owner_id: ownerId,
          width: info.width,
          height: info.height,
          duration_ms: info.durationMs,
          frame_count: info.frameCount,
          fps: info.fps,
        })}
        returning *`;
      return toAsset(row!);
    } catch (err) {
      await provider.delete(key).catch(() => {});
      throw err;
    }
  }

  async get(id: string): Promise<Asset | null> {
    const row = await findAssetRow(this.sql, id);
    return row && toAsset(row);
  }

  async list(kind: AssetKind | undefined, offset: number, limit: number): Promise<Page<Asset>> {
    const rows = await this.sql<AssetRow[]>`
      select * from assets
      ${kind ? this.sql`where kind = ${kind}` : this.sql``}
      order by ${kind === "font" ? this.sql`lower(name)` : this.sql`created_at desc`}, id
      offset ${offset} limit ${limit + 1}`;
    return {
      items: rows.slice(0, limit).map(toAsset),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }

  async open(id: string, range?: ByteRange): Promise<{ asset: Asset; object: StoredObject } | null> {
    const row = await findAssetRow(this.sql, id);
    if (!row) return null;
    const object = await this.providers.get(row.provider).get(row.storage_key, range);
    return { asset: toAsset(row), object };
  }

  /** Deletes metadata then bytes. Refuses while templates or memes reference the asset. */
  async delete(id: string): Promise<boolean> {
    const row = await findAssetRow(this.sql, id);
    if (!row) return false;
    const [ref] = await this.sql`
      select 1 from templates where asset_id = ${id}
      union all select 1 from memes where source_asset_id = ${id} or output_asset_id = ${id}
      limit 1`;
    if (ref) throw new HttpError(409, "asset is in use by a template or meme");
    await this.sql`delete from assets where id = ${id}`;
    await this.providers.get(row.provider).delete(row.storage_key);
    return true;
  }
}
