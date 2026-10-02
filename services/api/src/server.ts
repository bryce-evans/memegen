import { serve } from "@hono/node-server";
import { config, createSql, HeaderAuthProvider } from "@memegen/server-kit";
import { createApiApp } from "./app.ts";

const sql = createSql();
const app = createApiApp(sql, new HeaderAuthProvider(sql));

serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  console.log(`api listening on :${info.port}`);
});
