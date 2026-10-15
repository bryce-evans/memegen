import type { Asset } from "@memegen/shared";
import { AI_STUB_KEY, AI_STUB_RESULT } from "@memegen/server-kit/testing";
import { expect, scoped, test } from "./test.ts";
import { apiGet, fixture, signIn } from "./helpers.ts";

test("AI image: keys saved in the profile; prompt + background through a provider; the result becomes a template", async ({ page, request }) => {
  const username = scoped("aiartist");
  await page.goto("/create");
  await signIn(page, username);

  // Without a key, Generate is off and the form points to the profile.
  const form = page.getByTestId("ai-image");
  await expect(form.getByTestId("ai-generate")).toBeDisabled();
  await form.getByTestId("ai-no-key").getByRole("link").click();
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
  await form.getByTestId("ai-background-file").setInputFiles(fixture("still.png"));
  await expect(form.getByTestId("ai-background")).toBeVisible();
  await form.getByTestId("ai-prompt").fill("put a party hat on it");

  // A key the provider rejects shows its reason, and the user stays signed in.
  await form.getByTestId("ai-provider").selectOption("gemini");
  await form.getByTestId("ai-generate").click();
  await expect(form.getByTestId("ai-error")).toContainText("API key not valid");
  await expect(page.getByTestId("current-user")).toContainText(username);

  await form.getByTestId("ai-provider").selectOption("openai");
  await form.getByTestId("ai-generate").click();
  await expect(form.getByTestId("ai-result")).toBeVisible();
  await expect(form.getByTestId("ai-error")).toBeHidden();

  // Keeping the result uploads it and opens it in the Template Editor, named after the prompt.
  await form.getByTestId("ai-use-result").click();
  await expect(page).toHaveURL(/\/create\?newTemplate=[0-9a-f-]{36}$/);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("template-name")).toHaveValue("put a party hat on it");
  const assetId = new URL(page.url()).searchParams.get("newTemplate")!;
  const asset = await apiGet<Asset>(request, `/storage/assets/${assetId}`);
  expect([asset.kind, asset.width, asset.height]).toEqual(["image", AI_STUB_RESULT.width, AI_STUB_RESULT.height]);

  await page.goto(`/u/${username}?tab=ai`);
  await keys.getByTestId("ai-key-remove-gemini").click();
  await expect(keys.getByTestId("ai-key-status-gemini")).toHaveAttribute("data-connected", "false");
});
