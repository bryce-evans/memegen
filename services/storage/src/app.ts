import { Hono } from "hono";
import { z } from "zod";
import { ASSET_KINDS, pageQuerySchema } from "@memegen/shared";
import {
  findAssetRow,
  HttpError,
  idParam,
  installErrorHandler,
  isInternal,
  parse,
  toAsset,
  type AssetRow,
  type AuthProvider,
} from "@memegen/server-kit";
import type { AssetStore } from "./assets.ts";
import type { ByteRange } from "./providers/types.ts";

const listQuery = pageQuerySchema(50, 200).extend({ kind: z.enum(ASSET_KINDS).optional() });

/** Multipart overhead allowance on top of the file cap for the early Content-Length check. */
const MULTIPART_SLACK = 64 * 1024;

function parseRange(header: string | undefined, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? "invalid" : { start, end };
}

export function createStorageApp(store: AssetStore, auth: AuthProvider): Hono {
  const app = new Hono();
  installErrorHandler(app);

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/limits", (c) => c.json(store.limits));
  app.get("/providers", (c) => c.json({ default: store.providers.default.name, available: store.providers.names() }));

  app.post("/assets", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > store.limits.maxBytes + MULTIPART_SLACK) {
      throw new HttpError(413, "file too large", [`max is ${store.limits.maxBytes} bytes`]);
    }
    const user = await auth.resolve(c);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HttpError(400, "multipart field `file` is required");
    const name = typeof body.name === "string" ? body.name : undefined;
    const asset = await store.upload({
      data: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || "upload",
      name,
      ownerId: user?.id ?? null,
    });
    return c.json(asset, 201);
  });

  app.get("/assets", async (c) => {
    const q = parse(listQuery, c.req.query());
    return c.json(await store.list(q.kind, q.offset, q.limit));
  });

  const loadRow = async (id: string): Promise<AssetRow> => {
    const row = await findAssetRow(store.sql, id);
    if (!row) throw new HttpError(404, "asset not found");
    return row;
  };

  app.get("/assets/:id", async (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(toAsset(await loadRow(id)));
  });

  app.get("/assets/:id/content", async (c) => {
    const { id } = parse(idParam, c.req.param());
    const row = await loadRow(id);
    const size = Number(row.size_bytes);
    const range = parseRange(c.req.header("range"), size);
    if (range === "invalid") {
      return c.body(null, 416, { "content-range": `bytes */${size}` });
    }
    const object = await store.open(row, range ?? undefined);
    if (!object) throw new HttpError(404, "asset content not found");
    const headers: Record<string, string> = {
      "content-type": row.mime,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `inline; filename="${encodeURIComponent(row.filename)}"`,
    };
    if (range) {
      headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["content-length"] = String(range.end - range.start + 1);
      return c.body(object.body, 206, headers);
    }
    headers["content-length"] = String(size);
    return c.body(object.body, 200, headers);
  });

  app.delete("/assets/:id", async (c) => {
    const { id } = parse(idParam, c.req.param());
    const row = await loadRow(id);
    if (!isInternal(c)) {
      const user = await auth.resolve(c);
      if (!user || user.id !== row.owner_id) throw new HttpError(403, "only the owner can delete this asset");
    }
    await store.delete(row);
    return c.body(null, 204);
  });

  return app;
}
