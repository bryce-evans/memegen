import type { Context, Hono } from "hono";
import type { PanelSet, Template, User } from "@memegen/shared";
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
export async function ownMeme(sql: Sql, c: Context<Env>): Promise<{ user: User; id: string; meme: MemeRow }> {
  const user = requireUser(c);
  const { id } = parse(idParam, c.req.param());
  const meme = await loadMeme(sql, id, user);
  if (meme.owner_id !== user.id) throw new HttpError(403, "only the owner can change this meme");
  return { user, id, meme };
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

/** Pack images for a multi-panel template: existing still images (panels are drawn from one frame). */
export async function requirePackImages(sql: Sql, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const rows = await sql<{ kind: AssetRow["kind"] }[]>`select kind from assets where id in ${sql(ids as string[])}`;
  if (rows.length !== ids.length) throw new HttpError(400, "a pack image does not exist");
  if (rows.some((r) => r.kind !== "image")) throw new HttpError(400, "pack images must be still images");
}

/** A meme's panels checked against its template: required (from the pack) for multi-panel templates, else absent. */
export async function requireMemePanels(sql: Sql, templateId: string, panels: PanelSet | null | undefined): Promise<PanelSet | null> {
  const [template] = await sql<{ multi: boolean; pack: string[] }[]>`
    select t.panels is not null as multi,
      array(select tp.asset_id from template_pack_assets tp where tp.template_id = t.id) as pack
    from templates t where t.id = ${templateId}`;
  if (!template) throw new HttpError(404, "template not found");
  if (!template.multi) {
    if (panels) throw new HttpError(400, "this template has no panels");
    return null;
  }
  if (!panels) throw new HttpError(400, "multi-panel templates need panels");
  if (!panels.panels.every((p) => template.pack.includes(p.assetId))) {
    throw new HttpError(400, "panels must use images from the template's pack");
  }
  return panels;
}

/** A meme's rendered output: media the author uploaded themselves. */
export async function requireOwnOutput(sql: Sql, id: string, user: User): Promise<AssetRow> {
  const output = await requireMediaAsset(sql, id, "outputAssetId");
  if (output.owner_id !== user.id) throw new HttpError(403, "outputAssetId must be uploaded by you");
  return output;
}
