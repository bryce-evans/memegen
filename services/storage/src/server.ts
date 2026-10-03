import { serve } from "@hono/node-server";
import { config, createSql, HeaderAuthProvider } from "@memegen/server-kit";
import { assetStoreFromEnv } from "./assets.ts";
import { createStorageApp } from "./app.ts";

const sql = createSql();
const store = assetStoreFromEnv(sql);
const app = createStorageApp(store, new HeaderAuthProvider(sql));

serve({ fetch: app.fetch, port: config.storagePort }, (info) => {
  console.log(`storage listening on :${info.port} (provider: ${store.providers.default.name})`);
});
