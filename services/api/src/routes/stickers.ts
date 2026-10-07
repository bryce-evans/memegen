import { createStickerSchema, stickersQuerySchema, stickerViolations } from "@memegen/shared";
import { findAssetRow, HttpError, page, parse, parseJson, type Sql } from "@memegen/server-kit";
import { requireUser, type ApiApp } from "../access.ts";
import { stickerSelect, toSticker, type StickerRow } from "../rows.ts";

/** The sticker library: small PNGs anyone can add to a meme as image layers. */
export function register(app: ApiApp, sql: Sql): void {
  app.get("/api/stickers", async (c) => {
    const { offset, limit } = parse(stickersQuerySchema, c.req.query());
    const rows = await sql<StickerRow[]>`${stickerSelect(sql)}
      order by s.created_at desc, s.id
      offset ${offset} limit ${limit + 1}`;
    const { items, nextOffset } = page(rows, offset, limit);
    return c.json({ items: items.map(toSticker), nextOffset });
  });

  /** An uploaded PNG of the caller's, at most `STICKER_MAX_DIMENSION` on each edge, becomes a sticker. */
  app.post("/api/stickers", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createStickerSchema);
    const asset = await findAssetRow(sql, body.assetId);
    if (!asset) throw new HttpError(400, "assetId does not exist");
    if (asset.owner_id !== user.id) throw new HttpError(403, "assetId must be uploaded by you");
    const violations = stickerViolations(asset);
    if (violations.length) throw new HttpError(422, "file can't be a sticker", violations);
    const [row] = await sql<{ id: string }[]>`
      insert into stickers ${sql({ name: body.name, asset_id: asset.id, owner_id: user.id })}
      on conflict (asset_id) do nothing returning id`;
    if (!row) throw new HttpError(409, "that image is already a sticker");
    const [sticker] = await sql<StickerRow[]>`${stickerSelect(sql)} where s.id = ${row.id}`;
    return c.json(toSticker(sticker!), 201);
  });
}
