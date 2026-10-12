import { Hono } from "hono";
import { installAuth, installErrorHandler, type AuthProvider, type Env, type Sql } from "@memegen/server-kit";
import type { ApiApp } from "./access.ts";
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
  installAuth(app, auth);

  for (const routes of [users, templates, tags, memes, comments, gallery, stickers]) routes.register(app, sql);

  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
