import { serve } from "@hono/node-server";
import { createSql, searchConfig } from "@memegen/server-kit";
import { createSearchApp } from "./app.ts";
import { TemplateCatalog } from "./catalog.ts";
import { Clip } from "./clip.ts";
import { fetchFromStorage } from "./storage.ts";

// Listen at once; requests wait for the model (downloaded on first run) and the first sync.
const started = Date.now();
const clip = Clip.load(searchConfig.model, searchConfig.dataDir);
const catalog = new TemplateCatalog(createSql(), clip, fetchFromStorage(searchConfig.storageUrl), searchConfig.dataDir, searchConfig.model);

clip.then(
  () => console.log(`model ${searchConfig.model} loaded in ${Date.now() - started} ms`),
  (err: unknown) => {
    console.error(`can't load model ${searchConfig.model}:`, err);
    process.exit(1);
  },
);

serve({ fetch: createSearchApp(catalog).fetch, port: searchConfig.port }, (info) => {
  console.log(`search listening on :${info.port} (model: ${searchConfig.model})`);
});
