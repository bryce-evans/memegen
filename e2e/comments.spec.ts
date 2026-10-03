import type { Meme } from "@memegen/shared";
import { apiGet, apiMeme, apiPost, apiUser, memeCard, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("comments: post, reply, see the count on the card, delete (placeholder while replies remain)", async ({ page, request }) => {
  const author = await apiUser(request, scoped("op"));
  const meme = await apiMeme(request, author, { title: scoped("Discuss this") });
  const commenter = scoped("commenter");
  page.on("dialog", (dialog) => void dialog.accept());

  // Signed out: the discussion asks to sign in.
  await page.goto(`/m/${meme.id}`);
  const comments = page.getByTestId("comments");
  await expect(comments).toBeVisible();
  await expect(page.getByTestId("comment-input")).toHaveCount(0);

  await signIn(page, commenter);
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

  // Deleting a comment that has replies leaves a placeholder; deleting the last reply removes both.
  await parent.getByTestId("comment-delete").first().click();
  await expect(parent.getByTestId("comment-body").first()).not.toHaveText("first!");
  await expect(reply).toHaveCount(1);
  expect((await apiGet<Meme>(request, `/api/memes/${meme.id}`)).commentCount).toBe(1);

  await reply.getByTestId("comment-delete").click();
  await expect(comments.getByTestId("comment")).toHaveCount(0);
  expect((await apiGet<Meme>(request, `/api/memes/${meme.id}`)).commentCount).toBe(0);
});

test("comments: only the author can delete; drafts note that posting opens the discussion", async ({ page, request }) => {
  const author = await apiUser(request, scoped("op2"));
  const meme = await apiMeme(request, author, { title: scoped("Hands off") });
  const writer = await apiUser(request, scoped("writer"));
  await apiPost(request, `/api/memes/${meme.id}/comments`, writer, { body: "mine" });

  await page.goto(`/m/${meme.id}`);
  await signIn(page, author.username);
  const comment = page.getByTestId("comments").getByTestId("comment");
  await expect(comment.getByTestId("comment-body")).toHaveText("mine");
  await expect(comment.getByTestId("comment-delete")).toHaveCount(0);
  await expect(comment.getByTestId("comment-reply")).toBeVisible();

  const draft = await apiMeme(request, author, { title: scoped("Draft talk"), post: false });
  await page.goto(`/m/${draft.id}`);
  await expect(page.getByTestId("comments")).toContainText("Posting this meme publicly opens the discussion");
  await expect(page.getByTestId("comment-input")).toHaveCount(0);
});
