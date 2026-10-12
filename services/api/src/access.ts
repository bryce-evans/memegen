import type { Context, Hono } from "hono";
import type { Layer, PanelSet, Template, User } from "@memegen/shared";
import { findAssetRow, HttpError, idParam, parse, toUser, type AssetRow, type Env, type Sql, type UserRow } from "@memegen/server-kit";
import { memeOpenTo, memeSelect, templateSelect, templateVisibleTo, withVariations, type MemeRow, type TemplateRow } from "./rows.ts";

/** Loaders and guards shared by the route modules: each finds a record the caller may use, or throws. */

export type ApiApp = Hono<Env>;

export function requireUser(c: Context<Env>): User {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "sign in first");
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

/** Every id names an existing still image (one query); else 400 with `message`. */
async function requireStillImages(sql: Sql, ids: readonly string[], message: string): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from assets where id in ${sql(unique)} and kind = 'image'`;
  if (row!.count !== unique.length) throw new HttpError(400, message);
}

/** Pack images for a multi-panel template: existing still images (panels are drawn from one frame). */
export async function requirePackImages(sql: Sql, ids: readonly string[]): Promise<void> {
  await requireStillImages(sql, ids, "pack images must be existing still images");
}

/** Image layers draw existing still images (one frame, like pack images). */
export async function requireLayerImages(sql: Sql, layers: readonly Layer[] | undefined): Promise<void> {
  const ids = (layers ?? []).flatMap((l) => (l.type === "image" ? [l.assetId] : []));
  await requireStillImages(sql, ids, "image layers need an existing still image");
}

/** A template's pack asset ids in order, or null for a single-media template. */
export async function loadTemplatePack(sql: Sql, templateId: string): Promise<string[] | null> {
  const [template] = await sql<{ multi: boolean; pack: string[] }[]>`
    select t.panels is not null as multi,
      array(select tp.asset_id from template_pack_assets tp where tp.template_id = t.id order by tp.position) as pack
    from templates t where t.id = ${templateId}`;
  if (!template) throw new HttpError(404, "template not found");
  return template.multi ? template.pack : null;
}

/**
 * A meme's panels checked against its template's pack (`loadTemplatePack`): required and drawn from the pack for
 * multi-panel templates, else absent.
 */
export function requireMemePanels(pack: readonly string[] | null, panels: PanelSet | null | undefined): PanelSet | null {
  if (!pack) {
    if (panels) throw new HttpError(400, "this template has no panels");
    return null;
  }
  if (!panels) throw new HttpError(400, "multi-panel templates need panels");
  if (!panels.panels.every((p) => pack.includes(p.assetId))) {
    throw new HttpError(400, "panels must use images from the template's pack");
  }
  return panels;
}

/** An existing asset `user` uploaded themselves; `field` names the request field in errors. */
export async function requireOwnAsset(sql: Sql, id: string, field: string, user: User): Promise<AssetRow> {
  const asset = await findAssetRow(sql, id);
  if (!asset) throw new HttpError(400, `${field} does not exist`);
  if (asset.owner_id !== user.id) throw new HttpError(403, `${field} must be uploaded by you`);
  return asset;
}

/** A meme's rendered output: media the author uploaded themselves. */
export async function requireOwnOutput(sql: Sql, id: string, user: User): Promise<AssetRow> {
  const output = await requireOwnAsset(sql, id, "outputAssetId", user);
  if (output.kind === "font") throw new HttpError(400, "outputAssetId must be an image, gif, or video");
  return output;
}
