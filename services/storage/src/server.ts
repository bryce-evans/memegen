import { serve } from "@hono/node-server";
import { config, createSql, HeaderAuthProvider, uploadLimitsFromEnv } from "@memegen/server-kit";
import { AssetStore } from "./assets.ts";
import { createStorageApp } from "./app.ts";
import { createProviders } from "./providers/registry.ts";

const sql = createSql();
const providers = createProviders(process.env.STORAGE_PROVIDER || "local");
const store = new AssetStore(sql, providers, uploadLimitsFromEnv());
const app = createStorageApp(store, new HeaderAuthProvider(sql));

serve({ fetch: app.fetch, port: config.storagePort }, (info) => {
  console.log(`storage listening on :${info.port} (provider: ${providers.default.name})`);
});
