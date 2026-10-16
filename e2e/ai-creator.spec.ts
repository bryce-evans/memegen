import type { Asset, Template } from "@memegen/shared";
import { AI_STUB_KEY, AI_STUB_REFUSE, AI_STUB_RESULT } from "@memegen/server-kit/testing";
import type { Locator, Page } from "@playwright/test";
import { expect, scoped, test } from "./test.ts";
import { apiGet, apiTemplate, apiUser, signIn } from "./helpers.ts";

/** Search the Creator for a template by its (unique) name and pick it. */
async function pickTemplate(creator: Locator, template: Template): Promise<void> {
  await creator.getByTestId("ai-template-search").fill(template.name);
  await creator.locator(`[data-testid="ai-template-option"][data-template-id="${template.id}"]`).click();
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-template-id", template.id);
  await expect(creator.getByTestId("ai-canvas")).toHaveAttribute("data-ready", "true");
}

const agentRow = (scope: Page | Locator, name: string) => scope.locator(`[data-testid="ai-agent"][data-agent-name="${name}"]`);

/** Add an agent through the profile's AI agents tab (already open). */
async function addAgent(page: Page, agent: { name: string; provider: "openai" | "gemini"; key: string; instructions?: string }): Promise<void> {
  const panel = page.getByTestId("ai-agents");
  await panel.getByTestId("ai-agent-name").fill(agent.name);
  await panel.getByTestId("ai-agent-provider").selectOption(agent.provider);
  await panel.getByTestId("ai-agent-key").fill(agent.key);
  await panel.getByTestId("ai-agent-instructions").fill(agent.instructions ?? "");
  await panel.getByTestId("ai-agent-save").click();
  await expect(agentRow(panel, agent.name)).toBeVisible();
}

test("Creator: starts on a random template, its name searched and its boxes' text in the directions, drawn on the canvas", async ({ page, request }) => {
  await page.goto("/create");
  await signIn(page, scoped("creatorstart"));
  const creator = page.getByTestId("ai-creator");
  const canvas = creator.getByTestId("ai-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const template = await apiGet<Template>(request, `/api/templates/${await canvas.getAttribute("data-template-id")}`);
  await expect(creator.getByTestId("ai-template-search")).toHaveValue(template.name);
  const texts = template.defaultLayers.flatMap((l) => (l.type === "text" ? [l.text.replace(/\s*\n\s*/g, " ")] : []));
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const text of texts.length ? texts : ["TOP TEXT", "BOTTOM TEXT"]) await expect(creator.getByTestId("ai-describe")).toHaveValue(new RegExp(`: ${escape(text)}(\\n|$)`));
});

test("Creator: agents configured in the profile; the chosen one rewrites the boxes, adds a top section, and edits the image into a new template", async ({ page, request }) => {
  const username = scoped("aiartist");
  const owner = await apiUser(request, username);
  const template = await apiTemplate(request, owner, { name: scoped("ai-mod-base") });
  await page.goto("/create");
  await signIn(page, username);
  const creator = page.getByTestId("ai-creator");

  // Directions need an agent: without one, Create is off and the form points to the profile.
  await pickTemplate(creator, template);
  await expect(creator.getByTestId("ai-describe")).toHaveValue("Top text: TOP TEXT\nBottom text: BOTTOM TEXT");
  await expect(creator.getByTestId("ai-create")).toBeDisabled();
  await expect(creator.getByTestId("ai-agent-select")).toBeHidden();
  await creator.getByTestId("ai-no-agent").getByRole("link").click();
  await expect(page.getByTestId("profile-tab-ai")).toHaveAttribute("aria-pressed", "true");

  // Agents survive a reload; editing one without typing a key keeps its key.
  const panel = page.getByTestId("ai-agents");
  await addAgent(page, { name: "Gemini Bad Key", provider: "gemini", key: "not-a-real-key" });
  await addAgent(page, { name: "Stub Pal", provider: "openai", key: AI_STUB_KEY, instructions: "deadpan, lowercase" });
  await page.reload();
  await expect(panel.getByTestId("ai-agent")).toHaveCount(2);
  await agentRow(panel, "Gemini Bad Key").getByTestId("ai-agent-edit").click();
  await expect(panel.getByTestId("ai-agent-instructions")).toHaveValue("");
  await panel.getByTestId("ai-agent-name").fill("Gemini Nope");
  await panel.getByTestId("ai-agent-save").click();
  await expect(agentRow(panel, "Gemini Nope")).toBeVisible();
  await expect(panel.getByTestId("ai-agent")).toHaveCount(2);

  await page.getByTestId("nav-create").click();
  await pickTemplate(creator, template);
  await creator.getByTestId("ai-describe").fill("Top text: when the build passes\nBottom text: first try\ntop section: nobody:\nmod: put a party hat on it");
  await expect(creator.getByTestId("ai-no-agent")).toBeHidden();

  // A key the provider rejects shows its reason, and the user stays signed in.
  await creator.getByTestId("ai-agent-select").selectOption({ label: "Gemini Nope" });
  await creator.getByTestId("ai-create").click();
  await expect(creator.getByTestId("ai-error")).toContainText("API key not valid");
  await expect(page.getByTestId("current-user")).toContainText(username);

  // The agent's image edit becomes a new template named after it; its text lands in the template's own boxes, under
  // the top section it added.
  await creator.getByTestId("ai-agent-select").selectOption({ label: "Stub Pal" });
  await creator.getByTestId("ai-create").click();
  await expect(page).toHaveURL(/\/create\?newTemplate=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("template-name")).toHaveValue("put a party hat on it");
  const items = page.getByTestId("layer-item");
  await expect(items).toHaveCount(3);
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("nobody:");
  await expect(page.getByTestId("layer-text").nth(1)).toHaveValue("when the build passes");
  await expect(page.getByTestId("layer-text").nth(2)).toHaveValue("first try");
  await expect(items.first()).toHaveAttribute("data-top-section", "true");
  const assetId = new URL(page.url()).searchParams.get("newTemplate")!;
  const asset = await apiGet<Asset>(request, `/storage/assets/${assetId}`);
  expect([asset.kind, asset.width, asset.height]).toEqual(["image", AI_STUB_RESULT.width, AI_STUB_RESULT.height]);

  await page.goto(`/u/${username}?tab=ai`);
  await agentRow(panel, "Gemini Nope").getByTestId("ai-agent-remove").click();
  await expect(panel.getByTestId("ai-agent")).toHaveCount(1);
});

test("Creator: text-only directions fill the template's own boxes, never adding one; empty ones open it as is", async ({ page, request }) => {
  const username = scoped("aicaptioner");
  const owner = await apiUser(request, username);
  const template = await apiTemplate(request, owner, { name: scoped("ai-pick") });
  await page.goto(`/u/${username}?tab=ai`);
  await signIn(page, username);
  await addAgent(page, { name: "Stub Pal", provider: "openai", key: AI_STUB_KEY });
  await page.getByTestId("nav-create").click();
  const creator = page.getByTestId("ai-creator");
  await pickTemplate(creator, template);

  // A provider refusal is shown; the page stays put.
  await creator.getByTestId("ai-describe").fill(`nope ${AI_STUB_REFUSE}`);
  await creator.getByTestId("ai-create").click();
  await expect(creator.getByTestId("ai-error")).toContainText("OpenAI");
  await expect(page).toHaveURL(/\/create$/);

  // Two boxes, three lines: the agent can't add a box, so the last line is dropped.
  await creator.getByTestId("ai-describe").fill("me reading the docs\nme after reading the docs\nsame bug");
  await creator.getByTestId("ai-create").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("layer-text")).toHaveCount(2);
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("me reading the docs");
  await expect(page.getByTestId("layer-text").nth(1)).toHaveValue("me after reading the docs");

  // Empty directions: the template opens with its own text boxes.
  await page.goto("/create");
  await pickTemplate(creator, template);
  await creator.getByTestId("ai-describe").fill("");
  await creator.getByTestId("ai-create").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${template.id}$`));
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("layer-text").nth(0)).toHaveValue("TOP TEXT");
});
