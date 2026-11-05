import { Hono } from "hono";
import { installAuth, installErrorHandler, registerAuthRoutes, uploadLimitsFromEnv, type AuthProvider, type Env, type Sql } from "@memegen/server-kit";
import type { ApiApp } from "./access.ts";
import { createAiProviders, type AiProviders } from "./ai/registry.ts";
import * as ai from "./routes/ai.ts";
import * as comments from "./routes/comments.ts";
import * as gallery from "./routes/gallery.ts";
import * as memes from "./routes/memes.ts";
import * as stickers from "./routes/stickers.ts";
import * as tags from "./routes/tags.ts";
import * as templates from "./routes/templates.ts";
import type { TemplateSearch } from "./search.ts";
import * as users from "./routes/users.ts";
import * as feedback from "./routes/feedback.ts";
import * as admin from "./routes/admin.ts";
import { feedbackConnectorFromEnv, type FeedbackConnector } from "./feedback.ts";

export type { ApiApp } from "./access.ts";

export function createApiApp(
  sql: Sql,
  auth: AuthProvider,
  aiProviders: AiProviders = createAiProviders(),
  /** The search sidecar (`templateSearch()`); null = name and tag search only. */
  search: TemplateSearch | null = null,
  feedbackConnector: FeedbackConnector = feedbackConnectorFromEnv(),
): ApiApp {
  const app = new Hono<Env>();
  installErrorHandler(app);
  installAuth(app, auth);
  registerAuthRoutes(app, auth);

  for (const routes of [users, tags, memes, comments, gallery, stickers]) routes.register(app, sql);
  templates.register(app, sql, search);
  ai.register(app, aiProviders, uploadLimitsFromEnv());
  feedback.register(app, sql, feedbackConnector);
  admin.register(app, sql);

  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
