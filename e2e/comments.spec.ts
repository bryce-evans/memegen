import type { Comment, Meme } from "@memegen/shared";
import { apiGet, apiMeme, apiPost, apiUser, memeCard, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("comments: post, reply, see the count on the card, delete (placeholder while replies remain)", async ({ page, request }) => {
  const author = await apiUser(request, scoped("op"));
  const meme = await apiMeme(request, author, { title: scoped("Discuss this") });
  const commenter = scoped("commenter");
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(`/m/${meme.id}`);
  await signIn(page, commenter);
  const comments = page.getByTestId("comments");
  await page.getByTestId("comment-input").fill("first!");
  await page.getByTestId("comment-submit").click();
  const top = comments.getByTestId("comment");
  await expect(top).toHaveCount(1);
  await expect(top.getByTestId("comment-body")).toHaveText("first!");
  await expect(top.getByTestId("comment-author")).toHaveText(`@${commenter}`);
  const parentId = await top.getAttribute("data-comment-id");
  const parent = page.locator(`[data-testid="comment"][data-comment-id="${parentId}"]`);

  await parent.getByTestId("comment-reply").click();
  await parent.getByTestId("reply-input").fill("a reply");
  await parent.getByTestId("reply-submit").click();
  const reply = parent.locator('[data-testid="comment"]');
  await expect(reply).toHaveCount(1);
  await expect(reply.getByTestId("comment-body")).toHaveText("a reply");
  await expect(reply.getByTestId("comment-reply")).toHaveCount(0); // one level of replies

  // Persisted; the card links to the discussion with the count.
  expect((await apiGet<Meme>(request, `/api/memes/${meme.id}`)).commentCount).toBe(2);
  await page.goto(`/u/${author.username}`);
  const count = memeCard(page, meme.id).getByTestId("meme-comment-count");
  await expect(count).toContainText("2");
  await count.click();
  await expect(page).toHaveURL(new RegExp(`/m/${meme.id}#comments$`));
  await expect(reply.getByTestId("comment-body")).toHaveText("a reply");

  // Deleting a comment that has replies leaves an italic "deleted" placeholder; deleting the last reply removes both.
  await parent.getByTestId("comment-delete").first().click();
  await expect(parent).toHaveAttribute("data-deleted", "true");
  await expect(parent.getByTestId("comment-body").first()).toHaveText("deleted");
  await expect(parent.getByTestId("comment-deleted")).toHaveCSS("font-style", "italic");
  await expect(parent.getByTestId("comment-author")).toHaveCount(1); // only the reply's
  await expect(reply).toHaveCount(1);
  expect((await apiGet<Meme>(request, `/api/memes/${meme.id}`)).commentCount).toBe(1);

  await reply.getByTestId("comment-delete").click();
  await expect(comments.getByTestId("comment")).toHaveCount(0);
  expect((await apiGet<Meme>(request, `/api/memes/${meme.id}`)).commentCount).toBe(0);
});

test("comments: the author or the meme's owner can delete; drafts note that posting opens the discussion", async ({ page, request }) => {
  const author = await apiUser(request, scoped("op2"));
  const meme = await apiMeme(request, author, { title: scoped("Hands off") });
  const writer = await apiUser(request, scoped("writer"));
  const top = await apiPost<Comment>(request, `/api/memes/${meme.id}/comments`, writer, { body: "mine" });
  await apiPost(request, `/api/memes/${meme.id}/comments`, author, { body: "my reply", parentId: top.id });
  page.on("dialog", (dialog) => void dialog.accept());

  // A bystander can reply but delete nothing.
  await page.goto(`/m/${meme.id}`);
  await signIn(page, scoped("bystander"));
  const comments = page.getByTestId("comments");
  const parent = page.locator(`[data-testid="comment"][data-comment-id="${top.id}"]`);
  await expect(parent.getByTestId("comment-body").first()).toHaveText("mine");
  await expect(comments.getByTestId("comment-delete")).toHaveCount(0);
  await expect(parent.getByTestId("comment-reply")).toBeVisible();

  // The meme's owner can delete someone else's comment; its reply keeps it as a placeholder.
  await page.getByTestId("sign-out").click();
  await signIn(page, author.username);
  await expect(comments.getByTestId("comment-delete")).toHaveCount(2);
  await parent.getByTestId("comment-delete").first().click();
  await expect(parent.getByTestId("comment-body").first()).toHaveText("deleted");
  await expect(parent.locator('[data-testid="comment"]').getByTestId("comment-body")).toHaveText("my reply");
  expect((await apiGet<Meme>(request, `/api/memes/${meme.id}`)).commentCount).toBe(1);

  const draft = await apiMeme(request, author, { title: scoped("Draft talk"), post: false });
  await page.goto(`/m/${draft.id}`);
  await expect(page.getByTestId("comments")).toContainText("Posting this meme publicly opens the discussion");
  await expect(page.getByTestId("comment-input")).toHaveCount(0);
});
