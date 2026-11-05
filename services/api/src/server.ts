import { serve } from "@hono/node-server";
import { config, createAuthProvider, createSql } from "@memegen/server-kit";
import { createAiProviders } from "./ai/registry.ts";
import { createApiApp } from "./app.ts";
import { templateSearch } from "./search.ts";

const sql = createSql();
const app = createApiApp(sql, await createAuthProvider(sql), createAiProviders(), templateSearch());

serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  console.log(`api listening on :${info.port}`);
});
