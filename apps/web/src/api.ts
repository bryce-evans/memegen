import type {
  Asset,
  GallerySort,
  HotTemplate,
  Meme,
  Page,
  Period,
  Template,
  TemplateUsage,
  Tag,
  TagKind,
  TextLayer,
  UploadLimits,
  User,
  UserStats,
  Visibility,
} from "@memegen/shared";

const USER_KEY = "memegen.user";

export function storedUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function storeUser(user: User | null): void {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
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

// ---- storage --------------------------------------------------------------

export function contentUrl(asset: Pick<Asset, "contentPath">): string {
  return `/storage${asset.contentPath}`;
}

export function fontUrl(assetId: string): string {
  return `/storage/assets/${assetId}/content`;
}

export const getLimits = () => request<UploadLimits>("/storage/limits");

export const listFonts = () => request<Page<Asset>>(`/storage/assets${qs({ kind: "font", limit: 200 })}`);

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

export interface UserProfile {
  user: User;
  stats: UserStats;
}

export const createSession = (username: string) =>
  request<{ user: User }>("/api/session", { method: "POST", json: { username } });

export const getMe = () => request<UserProfile>("/api/me");

export const getUser = (username: string) => request<UserProfile>(`/api/users/${encodeURIComponent(username)}`);

export const getUserMemes = (username: string, offset = 0, limit = 24) =>
  request<Page<Meme>>(`/api/users/${encodeURIComponent(username)}/memes${qs({ offset, limit })}`);

export const listTemplates = (q: string, offset = 0, limit = 24, tag?: string) =>
  request<Page<Template>>(`/api/templates${qs({ q, offset, limit, tag })}`);

export const getTemplate = (id: string) => request<Template>(`/api/templates/${id}`);

export const getHotTemplates = (period: Period, limit = 12) =>
  request<HotTemplate[]>(`/api/templates/hot${qs({ period, limit })}`);

export const getTemplateUsage = (id: string, period: Period) =>
  request<TemplateUsage>(`/api/templates/${id}/usage${qs({ period })}`);

export interface CreateTemplateInput {
  name: string;
  assetId: string;
  parentId?: string | null;
  defaultLayers?: TextLayer[];
  isPublic?: boolean;
  tags?: string[];
}

export const createTemplate = (input: CreateTemplateInput) =>
  request<Template>("/api/templates", { method: "POST", json: input });

export const setTemplateTags = (id: string, tags: string[]) =>
  request<Template>(`/api/templates/${id}/tags`, { method: "PUT", json: { tags } });

export const listTags = (q = "", kind?: TagKind, limit = 100) => request<Tag[]>(`/api/tags${qs({ q, kind, limit })}`);

export const getTag = (slug: string) => request<Tag>(`/api/tags/${encodeURIComponent(slug)}`);

export const createTag = (input: { name: string; kind?: TagKind; description?: string }) =>
  request<Tag>("/api/tags", { method: "POST", json: input });

export type CreateMemeInput = {
  title: string;
  outputAssetId: string;
  layers: TextLayer[];
  visibility: Visibility;
  post: boolean;
  tags?: string[];
} & ({ templateId: string; sourceAssetId?: never } | { sourceAssetId: string; templateId?: never });

export const createMeme = (input: CreateMemeInput) => request<Meme>("/api/memes", { method: "POST", json: input });

export const getMeme = (id: string) => request<Meme>(`/api/memes/${id}`);

export type UpdateMemeInput = {
  title?: string;
  visibility?: Visibility;
  tags?: string[];
} & ({ layers: TextLayer[]; outputAssetId: string } | { layers?: never; outputAssetId?: never });

export const updateMeme = (id: string, input: UpdateMemeInput) =>
  request<Meme>(`/api/memes/${id}`, { method: "PATCH", json: input });

export const postMeme = (id: string) => request<Meme>(`/api/memes/${id}/post`, { method: "POST" });

export const deleteMeme = (id: string) => request<void>(`/api/memes/${id}`, { method: "DELETE" });

export const voteMeme = (id: string, value: -1 | 0 | 1) =>
  request<Meme>(`/api/memes/${id}/vote`, { method: "PUT", json: { value } });

export const getGallery = (period: Period, sort: GallerySort, offset = 0, limit = 24, tag?: string) =>
  request<Page<Meme>>(`/api/gallery${qs({ period, sort, offset, limit, tag })}`);
