import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { FeedbackPayload } from "@memegen/shared";
import { test, expect, scoped } from "./test.ts";
import { apiMeme, apiTemplate, apiUser, fixture, signIn } from "./helpers.ts";
import { FEEDBACK_SINK_PORT } from "./environment.ts";

type Delivery = FeedbackPayload & { user: { id: string; username: string }; screenshots: { name: string; contentType: string; base64: string }[] };
let server: Server;
let status = 200;
let deliveries: Delivery[] = [];

test.beforeAll(async () => {
  // A real HTTP destination: the application must parse multipart, authenticate, and invoke its webhook connector.
  server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/deliver") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const delivery = JSON.parse(Buffer.concat(chunks).toString()) as Delivery;
    if (status === 200) deliveries.push(delivery);
    response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ delivered: status === 200 }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(FEEDBACK_SINK_PORT, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test.beforeEach(() => {
  status = 200;
  deliveries = [];
});

test("captures real private-filtered viewport, validates uploads, and preserves a failed delivery draft", async ({ page }) => {
  await page.goto("/");
  await signIn(page, scoped("feedback-capture"));
  await page.evaluate(() => {
    for (const [left, privateArea] of [[20, "private"], [120, "public"], [220, "api-key"]] as const) {
      const marker = document.createElement("div");
      marker.style.cssText = `position:fixed;left:${left}px;top:100px;width:80px;height:80px;background:rgb(1,2,254);z-index:1000`;
      if (privateArea === "private") marker.setAttribute("data-feedback-private", "");
      if (privateArea === "api-key") marker.setAttribute("data-testid", "ai-agents");
      document.body.append(marker);
    }
  });
  await page.getByTestId("feedback-open").click();
  await page.getByTestId("feedback-kind-bug").click();
  const automatic = page.locator('[data-testid="feedback-screenshot"][data-source="automatic"]').getByTestId("feedback-screenshot-image");
  await expect(automatic).toBeVisible();
  const captured = await automatic.evaluate(async (image) => {
    const blob = await (await fetch((image as HTMLImageElement).src)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return {
      magic: Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 8)),
      width: bitmap.width, height: bitmap.height,
      privatePixel: Array.from(context.getImageData(40, 120, 1, 1).data),
      publicPixel: Array.from(context.getImageData(140, 120, 1, 1).data),
      apiKeyPixel: Array.from(context.getImageData(240, 120, 1, 1).data),
    };
  });
  expect(captured.magic).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect({ width: captured.width, height: captured.height }).toEqual(page.viewportSize());
  expect(captured.publicPixel).toEqual([1, 2, 254, 255]);
  expect(captured.privatePixel).not.toEqual([1, 2, 254, 255]);
  expect(captured.apiKeyPixel).not.toEqual([1, 2, 254, 255]);

  const upload = page.getByTestId("feedback-upload");
  await upload.setInputFiles(fixture("still.png"));
  await expect(page.getByTestId("feedback-screenshot")).toHaveCount(2);
  await upload.setInputFiles(fixture("still.png"));
  await expect(page.getByTestId("feedback-upload-error")).toContainText("at most 2");
  await page.locator('[data-testid="feedback-screenshot"][data-source="upload"]').getByTestId("feedback-remove-screenshot").click();
  await upload.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await expect(page.getByTestId("feedback-upload-error")).toContainText("2 MiB or smaller");
  await upload.setInputFiles({ name: "not-an-image.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(page.getByTestId("feedback-upload-error")).toContainText("PNG, JPEG, or WebP");
  await upload.setInputFiles(fixture("still.png"));
  await page.getByTestId("feedback-message").fill("The preview behaves unexpectedly.");
  status = 503;
  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-error")).toBeVisible();
  await expect(page.getByTestId("feedback-message")).toHaveValue("The preview behaves unexpectedly.");
  await expect(page.getByTestId("feedback-screenshot")).toHaveCount(2);
  await expect(page.getByTestId("feedback-success")).toHaveCount(0);
  expect(deliveries).toEqual([]);
  status = 200;
  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-success")).toBeVisible();
  expect(deliveries).toHaveLength(1);
  const delivered = deliveries[0]!;
  expect(delivered).toMatchObject({ kind: "bug", message: "The preview behaves unexpectedly.", path: "/", user: { username: scoped("feedback-capture") } });
  expect(delivered.screenshots).toHaveLength(2);
  expect(Buffer.from(delivered.screenshots[0]!.base64, "base64").subarray(0, 8)).toEqual(Buffer.from(captured.magic));
  expect(Buffer.from(delivered.screenshots[1]!.base64, "base64")).toEqual(readFileSync(fixture("still.png")));
});

test("capture failure offers manual upload; browser network failure keeps the draft", async ({ page }) => {
  await page.goto("/?private-query=not-for-feedback#private-hash");
  await signIn(page, scoped("feedback-manual"));
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); }; });
  await page.getByTestId("feedback-open").click();
  await page.getByTestId("feedback-kind-suggestion").click();
  await expect(page.getByTestId("feedback-capture-error")).toContainText("Upload your own screenshot");
  await expect(page.getByTestId("feedback-screenshot")).toHaveCount(0);
  await page.getByTestId("feedback-upload").setInputFiles(fixture("still.png"));
  await page.getByTestId("feedback-message").fill("Please add a clearer preview.");
  await page.route("**/api/feedback", (route) => route.abort("failed"));
  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-error")).toBeVisible();
  await expect(page.getByTestId("feedback-message")).toHaveValue("Please add a clearer preview.");
  await expect(page.getByTestId("feedback-screenshot")).toHaveCount(1);
  await page.unroute("**/api/feedback");
  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-success")).toBeVisible();
  expect(deliveries[0]).toMatchObject({ kind: "suggestion", path: "/" });
  expect(deliveries[0]!.screenshots).toHaveLength(1);
  expect(Buffer.from(deliveries[0]!.screenshots[0]!.base64, "base64")).toEqual(readFileSync(fixture("still.png")));
});

test("signed-out feedback never captures and disabled delivery is clearly unavailable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.dataset.captureAttempts = "0";
    HTMLCanvasElement.prototype.toBlob = () => {
      document.body.dataset.captureAttempts = String(Number(document.body.dataset.captureAttempts) + 1);
      throw new Error("Must not capture sign-in");
    };
  });
  await page.getByTestId("feedback-open").click();
  await expect(page.getByTestId("feedback-sign-in")).toBeVisible();
  await expect(page.getByTestId("feedback-screenshot")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.captureAttempts)).toBe("0");
  await page.getByTestId("feedback-dialog").press("Escape");
  await signIn(page, scoped("feedback-disabled"));
  await page.route("**/api/feedback/config", (route) => route.fulfill({ json: { enabled: false } }));
  await page.reload();
  await page.getByTestId("feedback-open").click();
  await expect(page.getByTestId("feedback-unavailable")).toBeVisible();
  await expect(page.getByTestId("feedback-submit")).toHaveCount(0);
  expect(deliveries).toEqual([]);
});

test("a hug can be sent without the removed screenshot after reopening its draft", async ({ page }) => {
  await page.goto("/");
  await signIn(page, scoped("feedback-hug"));
  await page.getByTestId("feedback-open").click();
  await page.getByTestId("feedback-kind-hug").click();
  await page.getByTestId("feedback-remove-screenshot").click();
  await page.getByTestId("feedback-message").fill("Thank you for making this!");
  await page.getByTestId("feedback-dialog").press("Escape");
  await page.getByTestId("feedback-open").click();
  await expect(page.getByTestId("feedback-message")).toHaveValue("Thank you for making this!");
  await expect(page.getByTestId("feedback-screenshot")).toHaveCount(0);
  await page.getByTestId("feedback-submit").click();
  await expect(page.getByTestId("feedback-success")).toBeVisible();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({ kind: "hug", message: "Thank you for making this!", screenshots: [] });
});

test("flagging a post stays on the page, restores focus, and retains failed or cancelled drafts", async ({ page, request }) => {
  const username = scoped("feedback-report");
  const user = await apiUser(request, username);
  const meme = await apiMeme(request, user, { title: "Flag post context" });
  const path = `/m/${meme.id}`;
  await page.goto(`${path}?private-query=not-for-feedback#private-hash`);
  await signIn(page, username);
  const url = page.url();
  const button = page.getByTestId("report-button");
  const dialog = page.getByTestId("report-dialog");
  await button.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await button.click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("meme-title")).toHaveText("Flag post context");
  await expect(page.getByTestId("report-target")).toContainText(meme.id);
  await expect(page.getByTestId("report-submit")).toBeDisabled();
  await expect(dialog.getByTestId("dialog-close")).toBeFocused();
  await page.getByTestId("report-reason").selectOption("violence");
  await page.getByTestId("report-message").fill("Please review this post.");
  await dialog.getByTestId("report-cancel").click();
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  expect(deliveries).toEqual([]);
  await button.click();
  await expect(page.getByTestId("report-reason")).toHaveValue("violence");
  await expect(page.getByTestId("report-message")).toHaveValue("Please review this post.");
  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await button.click();
  await dialog.getByTestId("dialog-close").click();
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await button.click();
  status = 503;
  await page.getByTestId("report-submit").click();
  await expect(page.getByTestId("report-error")).toBeVisible();
  await expect(page.getByTestId("report-reason")).toHaveValue("violence");
  await expect(page.getByTestId("report-message")).toHaveValue("Please review this post.");
  await expect(page.getByTestId("report-success")).toHaveCount(0);
  await expect(page).toHaveURL(url);
  expect(deliveries).toEqual([]);
  status = 200;
  await page.getByTestId("report-submit").click();
  await expect(page.getByTestId("report-success")).toBeVisible();
  expect(deliveries).toEqual([expect.objectContaining({
    kind: "report", target: { kind: "meme", id: meme.id }, reason: "violence",
    message: "Please review this post.", path, screenshots: [],
  })]);
  await dialog.getByTestId("report-done").click();
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("meme-title")).toHaveText("Flag post context");
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await button.click();
  await expect(page.getByTestId("report-reason")).toHaveValue("");
  await expect(page.getByTestId("report-message")).toHaveValue("");
  await expect(page.getByTestId("report-submit")).toBeDisabled();
});

test("flagging a template preserves its editor and sends the template reference without screenshots", async ({ page, request }) => {
  const username = scoped("feedback-template");
  const user = await apiUser(request, username);
  const template = await apiTemplate(request, user, { name: "Flag template context" });
  await page.goto(`/create?template=${template.id}`);
  await signIn(page, username);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("stage-preview").check();
  const url = page.url();
  const button = page.getByTestId("report-button");
  await button.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await button.click();
  const dialog = page.getByTestId("report-dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("stage-canvas")).toBeAttached();
  await expect(page.getByTestId("report-target")).toContainText(template.id);
  await page.getByTestId("report-reason").selectOption("other");
  await page.getByTestId("report-submit").click();
  await expect(page.getByTestId("report-success")).toBeVisible();
  expect(deliveries).toEqual([expect.objectContaining({
    kind: "report", target: { kind: "template", id: template.id }, reason: "other", message: "", path: "/create", screenshots: [],
  })]);
  await dialog.getByTestId("report-done").click();
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("stage-preview")).toBeChecked();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
});

test("flag dialog handles unavailable delivery and retries availability without leaving the post", async ({ page, request }) => {
  const username = scoped("flag-unavailable");
  const user = await apiUser(request, username);
  const meme = await apiMeme(request, user, { title: "Unavailable flag context" });
  await page.route("**/api/feedback/config", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(`/m/${meme.id}`);
  await signIn(page, username);
  const url = page.url();
  const button = page.getByTestId("report-button");
  const dialog = page.getByTestId("report-dialog");
  await button.click();
  await expect(dialog.getByTestId("report-availability-error")).toContainText("Could not check feedback availability");
  await expect(page.getByTestId("report-submit")).toHaveCount(0);
  await page.unroute("**/api/feedback/config");
  await dialog.getByTestId("report-retry").click();
  await expect(page.getByTestId("report-reason")).toBeVisible();
  await dialog.press("Escape");
  await page.route("**/api/feedback/config", (route) => route.fulfill({ json: { enabled: false } }));
  await page.reload();
  await button.click();
  await expect(page.getByTestId("report-unavailable")).toBeVisible();
  await expect(page.getByTestId("report-submit")).toHaveCount(0);
  await dialog.getByTestId("dialog-close").click();
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("meme-title")).toHaveText("Unavailable flag context");
  expect(deliveries).toEqual([]);
});
