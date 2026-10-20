import type { Page } from "@playwright/test";
import { expect, scoped, test } from "./test.ts";
import { apiTemplate, apiUpload, apiUser, signIn } from "./helpers.ts";

const duplicate = (page: Page, templateId: string) =>
  page.getByTestId("template-duplicates").locator(`[data-testid="template-duplicate"][data-template-id="${templateId}"]`);

test("Template Editor: an upload that is already a template (same file, or a re-encoded copy) lists it before saving", async ({
  page,
  request,
}) => {
  const curator = scoped("dupe-curator");
  const user = await apiUser(request, curator);
  const original = await apiTemplate(request, user, { file: "dup.png", name: scoped("Dup Original") });

  await page.goto("/");
  await signIn(page, curator);

  // The same file again: an exact copy.
  const same = await apiUpload(request, user, "dup.png");
  await page.goto(`/create?newTemplate=${same.id}`);
  await expect(duplicate(page, original.id)).toHaveAttribute("data-exact", "true");
  await expect(duplicate(page, original.id)).toContainText(original.name);

  // The same picture re-encoded as JPEG: different bytes, found by the search sidecar's image similarity.
  const copy = await apiUpload(request, user, "dup.jpg");
  await page.goto(`/create?newTemplate=${copy.id}`);
  await expect(duplicate(page, original.id)).toHaveAttribute("data-exact", "false");
  await expect(duplicate(page, original.id)).toContainText("% alike");

  // Its link opens the existing template instead.
  await duplicate(page, original.id).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/create\\?template=${original.id}$`));
  await expect(page.getByTestId("template-duplicates")).toHaveCount(0);
});
