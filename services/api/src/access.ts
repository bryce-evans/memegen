import type { Context, Hono } from "hono";
import type { Template, User } from "@memegen/shared";
import { findAssetRow, HttpError, idParam, parse, toUser, type AssetRow, type Sql, type UserRow } from "@memegen/server-kit";
import { memeOpenTo, memeSelect, templateSelect, templateVisibleTo, withVariations, type MemeRow, type TemplateRow } from "./rows.ts";

/** Loaders and guards shared by the route modules: each finds a record the caller may use, or throws. */

export type Env = { Variables: { user: User | null } };
export type ApiApp = Hono<Env>;

export function requireUser(c: Context<Env>): User {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "sign in first (X-User-Id)");
  return user;
}

export async function findUserByName(sql: Sql, username: string): Promise<User> {
  const [row] = await sql<UserRow[]>`
    select id, username, created_at from users where lower(username) = lower(${username})`;
  if (!row) throw new HttpError(404, "user not found");
  return toUser(row);
}

export async function loadMeme(sql: Sql, id: string, viewer: User | null): Promise<MemeRow> {
  const viewerId = viewer?.id ?? null;
  const [row] = await sql<MemeRow[]>`${memeSelect(sql, viewerId)} where m.id = ${id} and ${memeOpenTo(sql, viewerId)}`;
  if (!row) throw new HttpError(404, "meme not found");
  return row;
}

/** The signed-in user and the `:id` meme they own; 403 for anyone else's. */
export async function ownMeme(sql: Sql, c: Context<Env>): Promise<{ user: User; id: string }> {
  const user = requireUser(c);
  const { id } = parse(idParam, c.req.param());
  const meme = await loadMeme(sql, id, user);
  if (meme.owner_id !== user.id) throw new HttpError(403, "only the owner can change this meme");
  return { user, id };
}

export async function loadTemplate(sql: Sql, id: string, viewer: User | null): Promise<Template> {
  const viewerId = viewer?.id ?? null;
  const rows = await sql<TemplateRow[]>`${templateSelect(sql)}
    where t.id = ${id} and ${templateVisibleTo(sql, viewerId)}`;
  const [template] = await withVariations(sql, rows, viewerId);
  if (!template) throw new HttpError(404, "template not found");
  return template;
}

/** The signed-in user and the `:id` template they own; 403 for anyone else's. */
export async function ownTemplate(sql: Sql, c: Context<Env>): Promise<{ user: User; id: string }> {
  const user = requireUser(c);
  const { id } = parse(idParam, c.req.param());
  const [row] = await sql<{ owner_id: string }[]>`select owner_id from templates where id = ${id}`;
  if (!row) throw new HttpError(404, "template not found");
  if (row.owner_id !== user.id) throw new HttpError(403, "only the owner can change this template");
  return { user, id };
}

/** An existing image, gif, or video asset; `field` names the request field in errors. */
export async function requireMediaAsset(sql: Sql, id: string, field: string): Promise<AssetRow> {
  const asset = await findAssetRow(sql, id);
  if (!asset) throw new HttpError(400, `${field} does not exist`);
  if (asset.kind === "font") throw new HttpError(400, `${field} must be an image, gif, or video`);
  return asset;
}

/** A meme's rendered output: media the author uploaded themselves. */
export async function requireOwnOutput(sql: Sql, id: string, user: User): Promise<AssetRow> {
  const output = await requireMediaAsset(sql, id, "outputAssetId");
  if (output.owner_id !== user.id) throw new HttpError(403, "outputAssetId must be uploaded by you");
  return output;
}
