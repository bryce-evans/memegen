import { assetContentPath } from "@memegen/shared";
import type {
  Asset,
  Comment,
  GallerySort,
  HotTemplate,
  LeaderboardEntry,
  LeaderboardSort,
  Meme,
  Page,
  Panel,
  PanelLayout,
  PanelSet,
  Period,
  Template,
  TemplateUsage,
  Tag,
  TagKind,
  TextLayer,
  UploadLimits,
  User,
  UserProfile,
  Visibility,
} from "@memegen/shared";

/** Cookie holding the signed-in user (JSON); a year, so the dev login survives restarts. Not a credential. */
const USER_COOKIE = "memegen.user";
const USER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return entry === undefined ? null : decodeURIComponent(entry.slice(prefix.length));
}

/** `null` deletes the cookie. */
function writeCookie(name: string, value: string | null): void {
  const lifetime = value === null ? "max-age=0" : `max-age=${USER_COOKIE_MAX_AGE}`;
  document.cookie = `${name}=${encodeURIComponent(value ?? "")}; ${lifetime}; path=/; SameSite=Lax`;
}

export function storedUser(): User | null {
  const raw = readCookie(USER_COOKIE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    writeCookie(USER_COOKIE, null);
    return null;
  }
}

export function storeUser(user: User | null): void {
  writeCookie(USER_COOKIE, user ? JSON.stringify(user) : null);
}

let onSessionRejected: () => void = () => {};

/** Called when the API rejects the stored user (e.g. the dev database was reset); AuthProvider signs out. */
export function setSessionRejectedHandler(handler: () => void): void {
  onSessionRejected = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  signal?: AbortSignal;
}

async function send(url: string, opts: RequestOptions = {}): Promise<Response> {
  const headers = new Headers();
  const user = storedUser();
  if (user) headers.set("X-User-Id", user.id);
  let body = opts.body;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: opts.signal });
  if (!res.ok) {
    // The stored user no longer exists server-side: forget it, so the app falls back to signed out.
    if (res.status === 401 && user) {
      storeUser(null);
      onSessionRejected();
    }
    let message = `${res.status} ${res.statusText}`;
    let details: string[] = [];
    try {
      const data = (await res.json()) as { error?: unknown; details?: unknown };
      if (typeof data.error === "string") message = data.error;
      // Server errors carry `details: string[]` (validation issues or cap violations).
      if (Array.isArray(data.details)) details = data.details.map(String);
    } catch {
      // non-JSON error body (e.g. proxy failure); keep the status text
    }
    throw new ApiError(res.status, message, details);
  }
  return res;
}

async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(url, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Offset paging for list calls; omitted fields take the defaults each call documents. */
export interface PageParams {
  offset?: number;
  limit?: number;
}

// ---- storage --------------------------------------------------------------

export function contentUrl(asset: Pick<Asset, "contentPath">): string {
  return `/storage${asset.contentPath}`;
}

export const fontUrl = (assetId: string) => contentUrl({ contentPath: assetContentPath(assetId) });

export const getLimits = () => request<UploadLimits>("/storage/limits");

export const listFonts = () => request<Page<Asset>>(`/storage/assets${qs({ kind: "font", limit: 200 })}`);

export const getAsset = (id: string) => request<Asset>(`/storage/assets/${encodeURIComponent(id)}`);

export function uploadAsset(file: Blob, filename: string, name?: string, signal?: AbortSignal): Promise<Asset> {
  const form = new FormData();
  form.append("file", file, filename);
  if (name) form.append("name", name);
  return request<Asset>("/storage/assets", { method: "POST", body: form, signal });
}

export async function fetchAssetBlob(asset: Asset, signal?: AbortSignal): Promise<Blob> {
  const res = await send(contentUrl(asset), { signal });
  const blob = await res.blob();
  // Keep the stored mime so decoders/exporters see the right type even if the server omits it.
  return blob.type ? blob : new Blob([blob], { type: asset.mime });
}

// ---- api ------------------------------------------------------------------

export const createSession = (username: string) =>
  request<{ user: User }>("/api/session", { method: "POST", json: { username } });

export const getMe = () => request<UserProfile>("/api/me");

export const getUser = (username: string) => request<UserProfile>(`/api/users/${encodeURIComponent(username)}`);

export const getUserMemes = (username: string, { offset = 0, limit = 24 }: PageParams = {}) =>
  request<Page<Meme>>(`/api/users/${encodeURIComponent(username)}/memes${qs({ offset, limit })}`);

/** Templates the user added (variations included), newest first; their owner also sees private ones. */
export const getUserTemplates = (username: string, { offset = 0, limit = 24 }: PageParams = {}) =>
  request<Page<Template>>(`/api/users/${encodeURIComponent(username)}/templates${qs({ offset, limit })}`);

export const listTemplates = ({ q, tag, offset = 0, limit = 24 }: PageParams & { q?: string; tag?: string } = {}) =>
  request<Page<Template>>(`/api/templates${qs({ q, tag, offset, limit })}`);

export const getTemplate = (id: string) => request<Template>(`/api/templates/${id}`);

export const getHotTemplates = (period: Period, limit = 12) =>
  request<HotTemplate[]>(`/api/templates/hot${qs({ period, limit })}`);

export const getTemplateUsage = (id: string, period: Period) =>
  request<TemplateUsage>(`/api/templates/${id}/usage${qs({ period })}`);

export interface CreateTemplateInput {
  name: string;
  /** The media; for a multi-panel template, its rendered cover. */
  assetId: string;
  parentId?: string | null;
  defaultLayers?: TextLayer[];
  panels?: PanelTemplateInput | null;
  isPublic?: boolean;
  tags?: string[];
}

/** A multi-panel template as written: pack images by id, in order. */
export interface PanelTemplateInput {
  layout: PanelLayout;
  grid: boolean;
  fontSize: number;
  packAssetIds: string[];
  defaultPanels: Panel[];
}

export const createTemplate = (input: CreateTemplateInput) =>
  request<Template>("/api/templates", { method: "POST", json: input });

/**
 * Owner only: rename and/or replace the defaults (text boxes, or a multi-panel template's panels together with its
 * re-rendered cover; pack images can be added, never removed). Existing memes keep their own content.
 */
export const updateTemplate = (
  id: string,
  changes: { name?: string; defaultLayers?: TextLayer[] } & ({ panels: PanelTemplateInput; assetId: string } | { panels?: never; assetId?: never }),
) => request<Template>(`/api/templates/${id}`, { method: "PATCH", json: changes });

/** Adds (never removes) tags; the author's base tags always stay. */
export const addTemplateTags = (id: string, tags: string[]) =>
  request<Template>(`/api/templates/${id}/tags`, { method: "POST", json: { tags } });

export const listTags = ({ q, kind, limit = 100 }: { q?: string; kind?: TagKind; limit?: number } = {}) =>
  request<Tag[]>(`/api/tags${qs({ q, kind, limit })}`);

export const getTag = (slug: string) => request<Tag>(`/api/tags/${encodeURIComponent(slug)}`);

export const createTag = (input: { name: string; kind?: TagKind; description?: string }) =>
  request<Tag>("/api/tags", { method: "POST", json: input });

export interface CreateMemeInput {
  title: string;
  /** Every meme is made from an existing template. */
  templateId: string;
  outputAssetId: string;
  layers: TextLayer[];
  /** Required for multi-panel templates (with no layers). */
  panels: PanelSet | null;
  visibility: Visibility;
  post: boolean;
  tags?: string[];
}

export const createMeme = (input: CreateMemeInput) => request<Meme>("/api/memes", { method: "POST", json: input });

export const getMeme = (id: string) => request<Meme>(`/api/memes/${id}`);

export type UpdateMemeInput = {
  title?: string;
  visibility?: Visibility;
  tags?: string[];
} & ({ layers: TextLayer[]; panels: PanelSet | null; outputAssetId: string } | { layers?: never; panels?: never; outputAssetId?: never });

export const updateMeme = (id: string, input: UpdateMemeInput) =>
  request<Meme>(`/api/memes/${id}`, { method: "PATCH", json: input });

export const postMeme = (id: string) => request<Meme>(`/api/memes/${id}/post`, { method: "POST" });

export const deleteMeme = (id: string) => request<void>(`/api/memes/${id}`, { method: "DELETE" });

export const voteMeme = (id: string, value: -1 | 0 | 1) =>
  request<Meme>(`/api/memes/${id}/vote`, { method: "PUT", json: { value } });

export const getGallery = ({ period, sort, tag, offset = 0, limit = 24 }: PageParams & { period: Period; sort: GallerySort; tag?: string }) =>
  request<Page<Meme>>(`/api/gallery${qs({ period, sort, tag, offset, limit })}`);

export const getLeaderboard = (by: LeaderboardSort, limit = 50) =>
  request<LeaderboardEntry[]>(`/api/leaderboard${qs({ by, limit })}`);

/** Recent activity: memes the signed-in user voted on (either way), newest vote first. */
export const getMyActivity = ({ offset = 0, limit = 24 }: PageParams = {}) =>
  request<Page<Meme>>(`/api/me/activity${qs({ offset, limit })}`);

/** Memes the signed-in user starred, most recently starred first. */
export const getMyFavorites = ({ offset = 0, limit = 24 }: PageParams = {}) =>
  request<Page<Meme>>(`/api/me/favorites${qs({ offset, limit })}`);

export const favoriteMeme = (id: string, favorite: boolean) =>
  request<Meme>(`/api/memes/${id}/favorite`, { method: "PUT", json: { favorite } });

export const listComments = (memeId: string, { offset = 0, limit = 50 }: PageParams = {}) =>
  request<Page<Comment>>(`/api/memes/${memeId}/comments${qs({ offset, limit })}`);

export const createComment = (memeId: string, body: string, parentId: string | null = null) =>
  request<Comment>(`/api/memes/${memeId}/comments`, { method: "POST", json: { body, parentId } });

export const deleteComment = (id: string) => request<void>(`/api/comments/${id}`, { method: "DELETE" });
