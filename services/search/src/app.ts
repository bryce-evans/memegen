import { Hono } from "hono";
import { searchSimilarSchema, searchTextSchema, type SearchHits } from "@memegen/shared";
import { installErrorHandler, parseJson, requireInternal } from "@memegen/server-kit";
import type { TemplateCatalog } from "./catalog.ts";

/** The sidecar's routes. Only the API calls them, with `X-Internal-Token`; no web proxy forwards to this service. */
export function createSearchApp(catalog: TemplateCatalog): Hono {
  const app = new Hono();
  installErrorHandler(app);

  app.get("/health", (c) => c.json({ ok: true, templates: catalog.size }));

  app.post("/search", async (c) => {
    requireInternal(c);
    const { q, limit } = await parseJson(c, searchTextSchema);
    return c.json<SearchHits>({ hits: await catalog.searchText(q, limit) });
  });

  app.post("/similar", async (c) => {
    requireInternal(c);
    const { assetId, limit } = await parseJson(c, searchSimilarSchema);
    return c.json<SearchHits>({ hits: await catalog.similar(assetId, limit) });
  });

  return app;
}
