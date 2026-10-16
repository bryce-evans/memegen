import type { Asset, Template } from "@memegen/shared";
import { AI_STUB_KEY, AI_STUB_REFUSE, AI_STUB_RESULT } from "@memegen/server-kit/testing";
import type { Locator } from "@playwright/test";
import { expect, scoped, test } from "./test.ts";
import { apiGet, apiTemplate, apiUser, signIn } from "./helpers.ts";

/** Search the Creator for a template by its (unique) name and pick it. */
async function pickTemplate(creator: Locator, template: Template): Promise<void> {
  await creator.getByTestId("ai-template-search").fill(template.name);
  await creator.locator(`[data-testid="ai-template-option"][data-template-id="${template.id}"]`).click();
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-template-id", template.id);
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-ready", "true");
}

test("Creator: starts on a random template, its name searched and its text described, drawn on the canvas", async ({ page, request }) => {
  await page.goto("/create");
  await signIn(page, scoped("creatorstart"));
  const creator = page.getByTestId("ai-creator");
  const canvas = creator.getByTestId("ai-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const template = await apiGet<Template>(request, `/api/templates/${await canvas.getAttribute("data-template-id")}`);
  await expect(creator.getByTestId("ai-template-search")).toHaveValue(template.name);
  await expect(creator.getByTestId("ai-describe")).toHaveValue(/^top text: .*\nbottom text: .*$/);
});

test("Creator: keys saved in the profile; a description with a change to the image opens a prefilled new template", async ({ page, request }) => {
  const username = scoped("aiartist");
  const owner = await apiUser(request, username);
  const template = await apiTemplate(request, owner, { name: scoped("ai-mod-base") });
  await page.goto("/create");
  await signIn(page, username);
  const creator = page.getByTestId("ai-creator");

  // Describing needs a key: without any, Create is off and the form points to the profile.
  await pickTemplate(creator, template);
  await expect(creator.getByTestId("ai-describe")).toHaveValue("top text: TOP TEXT\nbottom text: BOTTOM TEXT");
  await expect(creator.getByTestId("ai-create")).toBeDisabled();
  await creator.getByTestId("ai-no-key").getByRole("link").click();
  await expect(page.getByTestId("profile-tab-ai")).toHaveAttribute("aria-pressed", "true");

  // Keys are per provider and survive a reload; Remove forgets one.
  const keys = page.getByTestId("ai-keys");
  await keys.getByTestId("ai-key-input-openai").fill(AI_STUB_KEY);
  await keys.getByTestId("ai-key-save-openai").click();
  await keys.getByTestId("ai-key-input-gemini").fill("not-a-real-key");
  await keys.getByTestId("ai-key-save-gemini").click();
  await page.reload();
  await expect(keys.getByTestId("ai-key-status-openai")).toHaveAttribute("data-connected", "true");
  await expect(keys.getByTestId("ai-key-status-gemini")).toHaveAttribute("data-connected", "true");

  await page.getByTestId("nav-create").click();
  await pickTemplate(creator, template);
  await creator.getByTestId("ai-describe").fill("top text: when the build passes\nbottom text: first try\nmod: put a party hat on it");
  await expect(creator.getByTestId("ai-no-key")).toBeHidden();

  // A key the provider rejects shows its reason, and the user stays signed in.
  await creator.getByTestId("ai-provider").selectOption("gemini");
  await creator.getByTestId("ai-create").click();
  await expect(creator.getByTestId("ai-error")).toContainText("API key not valid");
  await expect(page.getByTestId("current-user")).toContainText(username);

  // The model's change becomes a new template named after it; the placed captions (labels dropped) are its text.
  await creator.getByTestId("ai-provider").selectOption("openai");
  await creator.getByTestId("ai-create").click();
  await expect(page).toHaveURL(/\/create\?newTemplate=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("template-name")).toHaveValue("put a party hat on it");
  await expect(page.getByTestId("layer-text")).toHaveCount(2);
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("when the build passes");
  await expect(page.getByTestId("layer-text").nth(1)).toHaveValue("first try");
  const assetId = new URL(page.url()).searchParams.get("newTemplate")!;
  const asset = await apiGet<Asset>(request, `/storage/assets/${assetId}`);
  expect([asset.kind, asset.width, asset.height]).toEqual(["image", AI_STUB_RESULT.width, AI_STUB_RESULT.height]);

  await page.goto(`/u/${username}?tab=ai`);
  await keys.getByTestId("ai-key-remove-gemini").click();
  await expect(keys.getByTestId("ai-key-status-gemini")).toHaveAttribute("data-connected", "false");
});

test("Creator: a text-only description opens the template with the model's captions; an empty one opens it as is", async ({ page, request }) => {
  const username = scoped("aicaptioner");
  const owner = await apiUser(request, username);
  const template = await apiTemplate(request, owner, { name: scoped("ai-pick") });
  await page.goto(`/u/${username}?tab=ai`);
  await signIn(page, username);
  await page.getByTestId("ai-key-input-openai").fill(AI_STUB_KEY);
  await page.getByTestId("ai-key-save-openai").click();
  await page.getByTestId("nav-create").click();
  const creator = page.getByTestId("ai-creator");
  await pickTemplate(creator, template);

  // A provider refusal is shown; the page stays put.
  await creator.getByTestId("ai-describe").fill(`nope ${AI_STUB_REFUSE}`);
  await creator.getByTestId("ai-create").click();
  await expect(creator.getByTestId("ai-error")).toContainText("OpenAI");
  await expect(page).toHaveURL(/\/create$/);

  await creator.getByTestId("ai-describe").fill("me reading the docs\nme after reading the docs\nsame bug");
  await creator.getByTestId("ai-create").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("layer-text")).toHaveCount(3);
  await expect(page.getByTestId("layer-text").nth(2)).toHaveValue("same bug");

  // An empty description: the template opens with its own text boxes.
  await page.goto("/create");
  await pickTemplate(creator, template);
  await creator.getByTestId("ai-describe").fill("");
  await creator.getByTestId("ai-create").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("TOP TEXT");
});
