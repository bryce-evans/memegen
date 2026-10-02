import type { Context, Hono } from "hono";
import { z } from "zod";
import { config } from "./config.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Error `details` are always a list of human-readable strings. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    throw new HttpError(400, "invalid request", details);
  }
  return result.data;
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
  return parse(schema, body);
}

export function isInternal(c: Context): boolean {
  return config.internalToken !== "" && c.req.header("x-internal-token") === config.internalToken;
}

export function requireInternal(c: Context): void {
  if (config.internalToken === "") return;
  if (!isInternal(c)) throw new HttpError(403, "internal endpoint");
}

/** Postgres SQLSTATEs that represent client mistakes rather than server faults. */
const PG_ERRORS: Record<string, { status: number; message: string }> = {
  "23505": { status: 409, message: "already exists" },
  "23503": { status: 400, message: "referenced record does not exist" },
  "23514": { status: 400, message: "constraint violated" },
};

/** JSON error envelope for HttpError, zod-style 400s, and unexpected failures. */
export function installErrorHandler(app: Hono<any>): void {
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, details: err.details }, err.status as 400);
    }
    const pg = PG_ERRORS[(err as { code?: string }).code ?? ""];
    if (pg) return c.json({ error: err.message || pg.message }, pg.status as 400);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found" }, 404));
}
