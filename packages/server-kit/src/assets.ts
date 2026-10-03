import { assetContentPath, type Asset, type AssetKind } from "@memegen/shared";
import type { Sql } from "./db.ts";

/** An `assets` row; the storage service writes them, the API reads them for memes and templates. */
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
    contentPath: assetContentPath(r.id),
  };
}

export async function findAssetRow(sql: Sql, id: string): Promise<AssetRow | null> {
  const [row] = await sql<AssetRow[]>`select * from assets where id = ${id}`;
  return row ?? null;
}
