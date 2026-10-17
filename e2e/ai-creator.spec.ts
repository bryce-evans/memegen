import { AI_PROVIDERS, type AiProviderId, type Asset, type Meme, type Template, type TextLayer } from "@memegen/shared";
import { AI_STUB_KEY, AI_STUB_REFUSE, AI_STUB_RESULT } from "@memegen/server-kit/testing";
import type { Locator, Page } from "@playwright/test";
import { expect, scoped, test } from "./test.ts";
import { apiGet, apiTemplate, apiUser, memeIdFromUrl, signIn } from "./helpers.ts";

/** Search the Creator for a template by its (unique) name and pick it. */
async function pickTemplate(creator: Locator, template: Template): Promise<void> {
  await creator.getByTestId("ai-template-search").fill(template.name);
  await creator.locator(`[data-testid="ai-template-option"][data-template-id="${template.id}"]`).click();
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-template-id", template.id);
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-ready", "true");
}

/** Set the Agent Provider (`text`) or Image Generator (`image`) through the profile's API Keys tab (already open). */
async function setAi(page: Page, role: "text" | "image", config: { provider: AiProviderId; key: string }): Promise<void> {
  const panel = page.getByTestId("ai-agents");
  const button = panel.getByTestId(`ai-role-${role}`);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await panel.getByTestId("ai-config-provider").selectOption(config.provider);
  await panel.getByTestId("ai-config-key").fill(config.key);
  await panel.getByTestId("ai-config-save").click();
  await expect(button).toContainText(`: ${AI_PROVIDERS.find((p) => p.id === config.provider)!.label}`);
}

/** Click Update and wait for the canvas to draw that Update (the `n`th since the template was picked). */
async function update(creator: Locator, n: number): Promise<void> {
  await creator.getByTestId("ai-update").click();
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-updates", String(n));
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-ready", "true");
}

test("Creator: starts on a random template, its name searched and its boxes' text as the Describe placeholder, drawn on the canvas", async ({ page, request }) => {
  await page.goto("/create");
  await signIn(page, scoped("creatorstart"));
  const creator = page.getByTestId("ai-creator");
  const canvas = creator.getByTestId("ai-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const template = await apiGet<Template>(request, `/api/templates/${await canvas.getAttribute("data-template-id")}`);
  await expect(creator.getByTestId("ai-template-search")).toHaveValue(template.name);
  const texts = template.defaultLayers.flatMap((l) => (l.type === "text" ? [l.text.replace(/\s*\n\s*/g, " ")] : []));
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const text of texts.length ? texts : ["TOP TEXT", "BOTTOM TEXT"]) await expect(creator.getByTestId("ai-describe")).toHaveAttribute("placeholder", new RegExp(`: ${escape(text)}(\\n|$)`));
  await expect(creator.getByTestId("ai-describe")).toHaveValue("");
});

test("Creator: AI set in the profile; the Agent Provider rewrites the template's own boxes, the Image Generator edits the image into a new template", async ({ page, request }) => {
  const username = scoped("aiartist");
  const owner = await apiUser(request, username);
  const template = await apiTemplate(request, owner, { name: scoped("ai-mod-base") });
  await page.goto("/create");
  await signIn(page, username);
  const creator = page.getByTestId("ai-creator");

  // Without an Agent Provider, Describe is off (Update and Publish too) and the form points to the profile; the full
  // editor needs none.
  await pickTemplate(creator, template);
  await expect(creator.getByTestId("ai-describe")).toHaveAttribute("placeholder", "Top text: TOP TEXT\nBottom text: BOTTOM TEXT");
  await expect(creator.getByTestId("ai-describe")).toBeDisabled();
  await expect(creator.getByTestId("ai-update")).toBeDisabled();
  await expect(creator.getByTestId("ai-publish")).toBeDisabled();
  await expect(creator.getByTestId("ai-full-editor")).toBeEnabled();
  await creator.getByTestId("ai-no-agent").getByRole("link").click();
  await expect(page.getByTestId("profile-tab-ai")).toHaveAttribute("aria-pressed", "true");

  // Both settings start unset and survive a reload.
  const panel = page.getByTestId("ai-agents");
  await expect(panel.getByTestId("ai-role-image")).toHaveText("Image Generator: UNSET");
  await expect(panel.getByTestId("ai-role-text")).toHaveText("Agent Provider: UNSET");
  await setAi(page, "text", { provider: "gemini", key: "not-a-real-key" });
  await setAi(page, "image", { provider: "openai", key: AI_STUB_KEY });
  // Claude writes edits but doesn't generate images: it's offered for the Agent Provider only.
  const claude = panel.getByTestId("ai-config-provider").locator('option[value="anthropic"]');
  await expect(claude).toHaveCount(0);
  await panel.getByTestId("ai-role-text").click();
  await expect(claude).toHaveCount(1);
  await page.reload();
  await expect(panel.getByTestId("ai-role-text")).toHaveText("Agent Provider: Google Gemini");
  await expect(panel.getByTestId("ai-role-image")).toHaveText("Image Generator: OpenAI");

  await page.getByTestId("nav-create").click();
  await pickTemplate(creator, template);
  await creator.getByTestId("ai-describe").fill("Top text: when the build passes\nBottom text: first try\ntop section: nobody:\nmod: put a party hat on it");
  await expect(creator.getByTestId("ai-no-agent")).toBeHidden();

  // A key the provider rejects shows its reason, and the user stays signed in.
  await creator.getByTestId("ai-update").click();
  await expect(creator.getByTestId("ai-error")).toContainText("API key not valid");
  await expect(creator.getByTestId("ai-publish")).toBeDisabled();
  await expect(page.getByTestId("current-user")).toContainText(username);

  // Saving without typing a key keeps the stored one.
  await page.goto(`/u/${username}?tab=ai`);
  await setAi(page, "text", { provider: "openai", key: AI_STUB_KEY });
  await panel.getByTestId("ai-role-image").click();
  await expect(panel.getByTestId("ai-config-key")).toHaveValue("");
  await panel.getByTestId("ai-config-save").click();

  // Update draws the agent's text on the edited image; Full editor uploads it as a new template named after its
  // prompt, the text in the template's own boxes. The template has no top section, and the agent can't add one: that
  // line is dropped.
  await page.getByTestId("nav-create").click();
  await pickTemplate(creator, template);
  const directions = "Top text: when the build passes\nBottom text: first try\ntop section: nobody:\nmod: put a party hat on it";
  await creator.getByTestId("ai-describe").fill(directions);
  await update(creator, 1);
  await expect(page).toHaveURL(/\/create$/);
  await creator.getByTestId("ai-full-editor").click();
  await expect(page).toHaveURL(/\/create\?newTemplate=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("template-name")).toHaveValue("put a party hat on it");
  const items = page.getByTestId("layer-item");
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("when the build passes");
  await expect(page.getByTestId("layer-text").nth(1)).toHaveValue("first try");
  await expect(items.first()).not.toHaveAttribute("data-top-section", "true");
  const assetId = new URL(page.url()).searchParams.get("newTemplate")!;
  const asset = await apiGet<Asset>(request, `/storage/assets/${assetId}`);
  expect([asset.kind, asset.width, asset.height]).toEqual(["image", AI_STUB_RESULT.width, AI_STUB_RESULT.height]);

  // Without an Image Generator, the agent isn't offered UPDATE_IMAGE: the text still lands, on the template itself.
  await page.goto(`/u/${username}?tab=ai`);
  await panel.getByTestId("ai-role-image").click();
  await panel.getByTestId("ai-config-clear").click();
  await expect(panel.getByTestId("ai-role-image")).toHaveText("Image Generator: UNSET");
  await page.getByTestId("nav-create").click();
  await pickTemplate(creator, template);
  await creator.getByTestId("ai-describe").fill(directions);
  await update(creator, 1);
  await creator.getByTestId("ai-full-editor").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("when the build passes");
  await expect(page.getByTestId("layer-text").nth(1)).toHaveValue("first try");
});

test("Creator: Update with text-only directions from Claude fills the template's own boxes, never adding one, and builds on itself", async ({ page, request }) => {
  const username = scoped("aicaptioner");
  const owner = await apiUser(request, username);
  const template = await apiTemplate(request, owner, { name: scoped("ai-pick") });
  await page.goto(`/u/${username}?tab=ai`);
  await signIn(page, username);
  await setAi(page, "text", { provider: "anthropic", key: AI_STUB_KEY });
  await page.getByTestId("nav-create").click();
  const creator = page.getByTestId("ai-creator");
  await pickTemplate(creator, template);

  // A provider refusal is shown; the page stays put.
  await creator.getByTestId("ai-describe").fill(`nope ${AI_STUB_REFUSE}`);
  await creator.getByTestId("ai-update").click();
  await expect(creator.getByTestId("ai-error")).toContainText("Claude");
  await expect(page).toHaveURL(/\/create$/);

  // Two boxes, three lines: the agent can't add a box, so the last line is dropped. A second Update builds on the
  // first: the top box keeps its new text.
  await creator.getByTestId("ai-describe").fill("me reading the docs\nme after reading the docs\nsame bug");
  await update(creator, 1);
  await creator.getByTestId("ai-describe").fill("Bottom text: same bug");
  await update(creator, 2);
  await creator.getByTestId("ai-full-editor").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("layer-text")).toHaveCount(2);
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("me reading the docs");
  await expect(page.getByTestId("layer-text").nth(1)).toHaveValue("same bug");

  // Without an Update, Full editor opens the template with its own text boxes, whatever was typed.
  await page.goto("/create");
  await pickTemplate(creator, template);
  await creator.getByTestId("ai-describe").fill("not sent");
  await creator.getByTestId("ai-full-editor").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("TOP TEXT");
});

test("Creator: Publish posts the updated meme directly, an edited image saved as a new template first; nothing posts before an Update", async ({ page, request }) => {
  const username = scoped("aipublisher");
  const owner = await apiUser(request, username);
  const template = await apiTemplate(request, owner, { name: scoped("ai-publish-base"), tags: ["office"] });
  await page.goto(`/u/${username}?tab=ai`);
  await signIn(page, username);
  await setAi(page, "text", { provider: "openai", key: AI_STUB_KEY });
  await setAi(page, "image", { provider: "gemini", key: AI_STUB_KEY });
  await page.getByTestId("nav-create").click();
  const creator = page.getByTestId("ai-creator");
  await pickTemplate(creator, template);
  // Nothing typed (just the placeholder), or the placeholder's own text, isn't sent; nothing posts before an Update.
  await expect(creator.getByTestId("ai-describe")).toHaveValue("");
  await expect(creator.getByTestId("ai-update")).toBeDisabled();
  await creator.getByTestId("ai-describe").fill("Top text: TOP TEXT\nBottom text: BOTTOM TEXT");
  await expect(creator.getByTestId("ai-update")).toBeDisabled();
  await creator.getByTestId("ai-describe").fill("Top text: when the build passes\nBottom text: first try\nmod: put a party hat on it");
  await expect(creator.getByTestId("ai-publish")).toBeDisabled();

  await update(creator, 1);
  await creator.getByTestId("ai-publish").click();
  const meme = await apiGet<Meme>(request, `/api/memes/${await memeIdFromUrl(page)}`, owner);
  const made = await apiGet<Template>(request, `/api/templates/${meme.templateId}`, owner);
  expect([made.name, made.tags, meme.title, meme.tags, meme.visibility]).toEqual([
    "put a party hat on it",
    ["office"],
    "put a party hat on it",
    ["office"],
    "public",
  ]);
  expect(meme.postedAt).not.toBeNull();
  expect(meme.layers.map((l) => (l as TextLayer).text)).toEqual(["when the build passes", "first try"]);
  expect(made.defaultLayers.map((l) => (l as TextLayer).text)).toEqual(["when the build passes", "first try"]);
  expect([meme.outputAsset.kind, meme.sourceAsset.width, meme.sourceAsset.height]).toEqual(["image", AI_STUB_RESULT.width, AI_STUB_RESULT.height]);
});

test("Creator: the canvas is capped in height; a template that would pass it scales down at its own aspect", async ({ page, request }) => {
  const username = scoped("aicanvas");
  const owner = await apiUser(request, username);
  // Square: at this width the preview column is wider than the cap, so the height binds.
  const template = await apiTemplate(request, owner, { name: scoped("ai-square"), file: "panel-a.jpg" });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto("/create");
  await signIn(page, username);
  const creator = page.getByTestId("ai-creator");
  await pickTemplate(creator, template);
  const canvas = creator.getByTestId("ai-canvas");
  const box = (await canvas.boundingBox())!;
  const cap = await canvas.evaluate((el) => parseFloat(getComputedStyle(el).maxHeight));
  const column = await canvas.evaluate((el) => el.parentElement!.clientWidth);
  expect(column).toBeGreaterThan(cap);
  expect(box.height).toBeCloseTo(cap, 0);
  expect(box.width).toBeCloseTo(box.height, 0);
});
