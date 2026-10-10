import { apiMeme, apiUser, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("memes: only the owner gets Delete; deleting goes to their profile and the meme is gone", async ({ page, request }) => {
  const owner = await apiUser(request, scoped("deleter"));
  const meme = await apiMeme(request, owner, { title: scoped("Short-lived") });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(`/m/${meme.id}`);
  await signIn(page, scoped("passerby"));
  await expect(page.getByTestId("meme-title")).toHaveText(meme.title);
  await expect(page.getByTestId("delete-meme")).toHaveCount(0);

  await page.getByTestId("sign-out").click();
  await signIn(page, owner.username);
  await page.getByTestId("delete-meme").click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/u/${owner.username}`);
  expect((await request.get(`/api/memes/${meme.id}`)).status()).toBe(404);
});
