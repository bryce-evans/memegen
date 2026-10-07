import { Hono } from "hono";
import { installErrorHandler, type AuthProvider, type Sql } from "@memegen/server-kit";
import type { ApiApp, Env } from "./access.ts";
import * as comments from "./routes/comments.ts";
import * as gallery from "./routes/gallery.ts";
import * as memes from "./routes/memes.ts";
import * as stickers from "./routes/stickers.ts";
import * as tags from "./routes/tags.ts";
import * as templates from "./routes/templates.ts";
import * as users from "./routes/users.ts";

export type { ApiApp } from "./access.ts";

export function createApiApp(sql: Sql, auth: AuthProvider): ApiApp {
  const app = new Hono<Env>();
  installErrorHandler(app);

  app.use("*", async (c, next) => {
    c.set("user", await auth.resolve(c));
    await next();
  });

  for (const routes of [users, templates, tags, memes, comments, gallery, stickers]) routes.register(app, sql);

  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
