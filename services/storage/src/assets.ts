import { createHash } from "node:crypto";
import { limitViolations, supportedTypesLabel, type Asset, type AssetKind, type Page, type UploadLimits } from "@memegen/shared";
import { HttpError, page, toAsset, uploadLimitsFromEnv, type AssetRow, type Sql } from "@memegen/server-kit";
import { probe, ProbeError } from "./probe.ts";
import { createProviders, type Providers } from "./providers/registry.ts";
import { ObjectNotFoundError, type ByteRange, type StoredObject } from "./providers/types.ts";
import { sniff } from "./sniff.ts";

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
    // Cheap byte check before sniffing/probing; the media check below covers dimensions and frames.
    if (data.byteLength > this.limits.maxBytes) {
      throw new HttpError(413, "file too large", limitViolations(data.byteLength, null, this.limits));
    }
    const type = sniff(data);
    if (!type) throw new HttpError(415, `unsupported file type; expected ${supportedTypesLabel()}`);
    const media = await probe(type.kind, data).catch((err: unknown) => {
      throw err instanceof ProbeError ? new HttpError(422, err.message) : err;
    });
    if (media) {
      const violations = limitViolations(data.byteLength, media, this.limits);
      if (violations.length) throw new HttpError(422, "file exceeds upload limits", violations);
    }

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
          width: media?.width ?? null,
          height: media?.height ?? null,
          duration_ms: media?.durationMs ?? null,
          frame_count: media?.frameCount ?? null,
          fps: media?.fps ?? null,
        })}
        returning *`;
      return toAsset(row!);
    } catch (err) {
      await provider.delete(key).catch(() => {});
      throw err;
    }
  }

  async list(kind: AssetKind | undefined, offset: number, limit: number): Promise<Page<Asset>> {
    const rows = await this.sql<AssetRow[]>`
      select * from assets
      ${kind ? this.sql`where kind = ${kind}` : this.sql``}
      order by ${kind === "font" ? this.sql`lower(name)` : this.sql`created_at desc`}, id
      offset ${offset} limit ${limit + 1}`;
    return page(rows.map(toAsset), offset, limit);
  }

  /** The asset's bytes, or null when its row exists but the provider has no object for it. */
  async open(row: AssetRow, range?: ByteRange): Promise<StoredObject | null> {
    try {
      return await this.providers.get(row.provider).get(row.storage_key, range);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return null;
      throw err;
    }
  }

  /**
   * Deletes metadata then bytes. Refuses while templates (as media, pack image, or default image layer) or memes
   * (as source, output, or image layer) reference the asset.
   */
  async delete(row: AssetRow): Promise<void> {
    const imageLayer = this.sql.json([{ type: "image", assetId: row.id }] as never);
    const [ref] = await this.sql`
      select 1 from templates where asset_id = ${row.id} or default_layers @> ${imageLayer}
      union all select 1 from template_pack_assets where asset_id = ${row.id}
      union all select 1 from memes where source_asset_id = ${row.id} or output_asset_id = ${row.id} or layers @> ${imageLayer}
      limit 1`;
    if (ref) throw new HttpError(409, "asset is in use by a template or meme");
    await this.sql`delete from assets where id = ${row.id}`;
    await this.providers.get(row.provider).delete(row.storage_key);
  }
}

/** The store the storage service and seed scripts use: `STORAGE_PROVIDER` (default local) plus env upload caps. */
export function assetStoreFromEnv(sql: Sql): AssetStore {
  return new AssetStore(sql, createProviders(process.env.STORAGE_PROVIDER || "local"), uploadLimitsFromEnv());
}
