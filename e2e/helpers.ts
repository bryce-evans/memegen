import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { Asset, Meme, Template, User } from "@memegen/shared";

export const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

/** Dev login through the sign-in page, which every URL shows while signed out; the app then opens at that URL. */
export async function signIn(page: Page, username: string): Promise<void> {
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("current-user")).toContainText(username);
}

export async function apiUser(request: APIRequestContext, username: string): Promise<User> {
  const res = await request.post("/api/session", { data: { username } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { user: User }).user;
}

export async function apiGet<T>(request: APIRequestContext, path: string, user?: User): Promise<T> {
  const res = await request.get(path, { headers: user ? { "x-user-id": user.id } : {} });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** POST as `user` (JSON, or multipart for FormData), expecting `status`. */
export async function apiPost<T>(request: APIRequestContext, path: string, user: User, data: unknown, status = 201): Promise<T> {
  const body = data instanceof FormData ? { multipart: data } : { data };
  const res = await request.post(path, { headers: { "x-user-id": user.id }, ...body });
  expect(res.status(), await res.text()).toBe(status);
  return (await res.json()) as T;
}

export async function apiUpload(request: APIRequestContext, user: User, file: string): Promise<Asset> {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(readFileSync(fixture(file)))], file, { type: "application/octet-stream" }));
  return apiPost<Asset>(request, "/storage/assets", user, form);
}

/** A public template added by `user` through the API: on `assetId`, else on a fresh upload of `file` (still.png). */
export async function apiTemplate(
  request: APIRequestContext,
  user: User,
  opts: { file?: string; assetId?: string; name?: string; parentId?: string; tags?: string[] } = {},
): Promise<Template> {
  const { file = "still.png", name = file, ...body } = opts;
  const assetId = body.assetId ?? (await apiUpload(request, user, file)).id;
  return apiPost<Template>(request, "/api/templates", user, { ...body, name, assetId });
}

/** A posted meme created purely through the API (fixture as the output; a fresh template unless one is given). */
export async function apiMeme(
  request: APIRequestContext,
  user: User,
  body: { title: string; visibility?: "public" | "private"; post?: boolean; tags?: string[]; templateId?: string },
): Promise<Meme> {
  const templateId = body.templateId ?? (await apiTemplate(request, user, { name: body.title })).id;
  const output = await apiUpload(request, user, "still.png");
  return apiPost<Meme>(request, "/api/memes", user, { layers: [], post: true, ...body, templateId, outputAssetId: output.id });
}

export const memeCard = (scope: Page | Locator, id: string) => scope.locator(`[data-testid="meme-card"][data-meme-id="${id}"]`);
export const tagChip = (scope: Page | Locator, slug: string) => scope.locator(`[data-testid="tag-chip"][data-tag="${slug}"]`);
export const timelineFrame = (page: Page, index: number) => page.locator(`[data-testid="timeline-frame"][data-index="${index}"]`);

/** Add community tags through a template's details ("+ tags", type each, save). */
export async function addCommunityTags(scope: Page | Locator, tags: string[]): Promise<void> {
  await scope.getByTestId("template-tags-add").click();
  for (const tag of tags) {
    await scope.getByTestId("tags-input").fill(tag);
    await scope.getByTestId("tags-input").press("Enter");
  }
  await scope.getByTestId("tags-save").click();
}

/** Stream summary of a downloaded file via ffprobe (codec_type → frame count). */
export function probeStreams(bytes: Buffer, ext: string): Record<string, number> {
  const dir = join(import.meta.dirname, "..", ".data");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `probe-${Date.now()}${ext}`);
  writeFileSync(path, bytes);
  try {
    const out = execFileSync("ffprobe", [
      "-v", "error", "-count_frames", "-show_entries", "stream=codec_type,nb_read_frames", "-of", "csv=p=0", path,
    ]).toString();
    const streams: Record<string, number> = {};
    for (const line of out.trim().split("\n")) {
      const [type, frames] = line.split(",");
      if (type) streams[type] = Number(frames);
    }
    return streams;
  } finally {
    rmSync(path, { force: true });
  }
}

/** Snapshot of the stage pixels, to prove a UI action actually changed the render. */
export async function stagePixels(page: Page): Promise<string> {
  return page.getByTestId("stage-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL());
}

/** Drag a layer's selection box by (dx, dy) screen pixels. */
export async function dragLayer(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId("layer-box").nth(index).boundingBox();
  if (!box) throw new Error("layer box not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

export async function memeIdFromUrl(page: Page): Promise<string> {
  await page.waitForURL(/\/m\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  return page.url().split("/m/")[1]!;
}

export async function download(request: APIRequestContext, asset: Asset): Promise<Buffer> {
  const res = await request.get(`/storage${asset.contentPath}`);
  expect(res.ok()).toBeTruthy();
  return res.body();
}

/** Sign in as `username`, add `file` as their template (through the API), and open it in the editor once the stage is ready. */
export async function editFixture(
  page: Page,
  request: APIRequestContext,
  username: string,
  file: string,
): Promise<{ template: Template; user: User }> {
  await page.goto("/");
  await signIn(page, username);
  const user = await apiUser(request, username);
  const template = await apiTemplate(request, user, { file, name: `${username} ${file}` });
  await page.goto(`/create?template=${template.id}`);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  return { template, user };
}

/** Wait for the feed to finish loading, then click "Load more" until the list is complete. */
export async function loadAll(page: Page): Promise<void> {
  const feed = page.getByTestId("meme-feed");
  const more = page.getByTestId("load-more");
  await expect(feed).toHaveAttribute("aria-busy", "false");
  while (await more.isVisible()) {
    const before = await page.getByTestId("meme-card").count();
    await more.click();
    await expect.poll(() => page.getByTestId("meme-card").count()).toBeGreaterThan(before);
    await expect(feed).toHaveAttribute("aria-busy", "false");
  }
}

/**
 * Open the Recent or Popular feed from the side nav (Popular optionally for a period) and wait until the feed
 * on screen is that query and has loaded. Navigations render in a transition, so the URL alone can run ahead.
 */
export async function openFeed(page: Page, opts: { feed: "recent" | "popular"; period?: string }): Promise<void> {
  await page.getByTestId(`nav-${opts.feed}`).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(opts.feed === "recent" ? "/recent" : "/");
  if (opts.period) await page.getByTestId(`period-${opts.period}`).click();
  const feed = page.getByTestId("meme-feed");
  await expect(feed).toHaveAttribute("data-feed", opts.feed);
  if (opts.period) await expect(feed).toHaveAttribute("data-period", opts.period);
  await expect(feed).toHaveAttribute("aria-busy", "false");
}

/** Mock-dataset meme titles in on-screen order (cards created by other specs are skipped). */
export async function mockTitles(page: Page): Promise<string[]> {
  const texts = await page.getByTestId("meme-card").allInnerTexts();
  return texts.map((t) => /Mock: [^\n]+/.exec(t)?.[0]?.trim()).filter((t): t is string => Boolean(t));
}

/** `expected` appears in `actual` in this relative order. */
export function expectInOrder(actual: string[], expected: readonly string[]): void {
  const positions = expected.map((title) => actual.indexOf(title));
  expect(positions, `missing from ${JSON.stringify(actual)}`).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

/** Width/height from a PNG's IHDR chunk. */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
