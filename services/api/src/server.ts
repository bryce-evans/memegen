import { serve } from "@hono/node-server";
import { config, createSql, HeaderAuthProvider } from "@memegen/server-kit";
import { createAiProviders } from "./ai/registry.ts";
import { createApiApp } from "./app.ts";
import { templateSearch } from "./search.ts";

const sql = createSql();
const app = createApiApp(sql, new HeaderAuthProvider(sql), createAiProviders(), templateSearch());

serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  console.log(`api listening on :${info.port}`);
});
