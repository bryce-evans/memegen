import { createStickerSchema, stickersQuerySchema, stickerViolations } from "@memegen/shared";
import { HttpError, page, pageSql, parse, parseJson, type Sql } from "@memegen/server-kit";
import { requireOwnAsset, requireUser, type ApiApp } from "../access.ts";
import { stickerSelect, toSticker, type StickerRow } from "../rows.ts";

/** The sticker library: small PNGs anyone can add to a meme as image layers. */
export function register(app: ApiApp, sql: Sql): void {
  /** Most used first (posts, then saves), so popular stickers lead the picker; then newest. */
  app.get("/api/stickers", async (c) => {
    const { offset, limit } = parse(stickersQuerySchema, c.req.query());
    const rows = await sql<StickerRow[]>`
      select * from (${stickerSelect(sql)}) s
      order by s.use_count desc, s.saved_count desc, s.created_at desc, s.id
      ${pageSql(sql, offset, limit)}`;
    return c.json(page(rows.map(toSticker), offset, limit));
  });

  /** An uploaded PNG of the caller's, at most `STICKER_MAX_DIMENSION` on each edge, becomes a sticker. */
  app.post("/api/stickers", async (c) => {
    const user = requireUser(c);
    const body = await parseJson(c, createStickerSchema);
    const asset = await requireOwnAsset(sql, body.assetId, "assetId", user);
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
