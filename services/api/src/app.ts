import { Hono } from "hono";
import { installAuth, installErrorHandler, uploadLimitsFromEnv, type AuthProvider, type Env, type Sql } from "@memegen/server-kit";
import type { ApiApp } from "./access.ts";
import { createAiProviders, type AiProviders } from "./ai/registry.ts";
import * as ai from "./routes/ai.ts";
import * as comments from "./routes/comments.ts";
import * as gallery from "./routes/gallery.ts";
import * as memes from "./routes/memes.ts";
import * as stickers from "./routes/stickers.ts";
import * as tags from "./routes/tags.ts";
import * as templates from "./routes/templates.ts";
import * as users from "./routes/users.ts";

export type { ApiApp } from "./access.ts";

export function createApiApp(sql: Sql, auth: AuthProvider, aiProviders: AiProviders = createAiProviders()): ApiApp {
  const app = new Hono<Env>();
  installErrorHandler(app);
  installAuth(app, auth);

  for (const routes of [users, templates, tags, memes, comments, gallery, stickers]) routes.register(app, sql);
  ai.register(app, aiProviders, uploadLimitsFromEnv());

  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
