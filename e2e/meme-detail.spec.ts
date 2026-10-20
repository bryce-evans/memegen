import { apiMeme, apiUser, signIn, tagChip } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("meme page: Share copies the meme's link; the owner's actions sit in an 'Only visible to you' panel", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const owner = await apiUser(request, scoped("sharer"));
  const meme = await apiMeme(request, owner, { title: scoped("Shared"), tags: ["e2e-share"] });

  await page.goto(`/m/${meme.id}`);
  await signIn(page, scoped("passerby"));
  await expect(page.getByTestId("owner-actions")).toHaveCount(0);
  await page.getByTestId("share-meme").click();
  await expect(page.getByTestId("share-meme")).toHaveText("Copied link to clipboard!");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/m/${meme.id}`);
  await expect(page.getByTestId("share-meme")).toHaveText("Share");

  await page.getByTestId("sign-out").click();
  await signIn(page, owner.username);
  const panel = page.getByTestId("owner-actions");
  await expect(panel).toContainText("Only visible to you");
  for (const id of ["visibility-toggle", "edit-meme", "delete-meme"]) await expect(panel.getByTestId(id)).toBeVisible();

  // Editing tags shows them once, in the chip input, not also as links beside it.
  await expect(tagChip(page, "e2e-share")).toBeVisible();
  await page.getByTestId("edit-tags").click();
  await expect(page.getByTestId("tags-input")).toBeVisible();
  await expect(tagChip(page, "e2e-share")).toHaveCount(0);
});

test("meme page: the age shows the full posting date and time in a tooltip on hover", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("dated"));
  const meme = await apiMeme(request, owner, { title: scoped("Dated") });

  await page.goto(`/m/${meme.id}`);
  await signIn(page, owner.username);
  const age = page.getByTestId("meme-age");
  await expect(age).toHaveText("just now");
  const full = new Date(meme.postedAt!).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
  await expect(page.getByRole("tooltip", { name: full })).toBeHidden();
  await age.hover();
  await expect(page.getByRole("tooltip", { name: full })).toBeVisible();
});
