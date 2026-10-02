import { expect, test } from "@playwright/test";
import { apiMeme, apiUser, signIn } from "./helpers.ts";

test("gallery: visibility rules, thumbs up/down counts, sorting, profile stats", async ({ page, request }) => {
  const alice = await apiUser(request, "gallery-alice");
  const alpha = await apiMeme(request, alice, { title: "Alpha" });
  const beta = await apiMeme(request, alice, { title: "Beta" });
  const secret = await apiMeme(request, alice, { title: "Secret", visibility: "private" });
  const draft = await apiMeme(request, alice, { title: "Drafty", post: false });

  await page.goto("/");
  await signIn(page, "gallery-bob");
  await page.getByTestId("period-all").click();
  await page.getByTestId("sort-new").click();
  const card = (id: string) => page.locator(`[data-testid="meme-card"][data-meme-id="${id}"]`);
  await expect(card(alpha.id)).toBeVisible();
  await expect(card(beta.id)).toBeVisible();
  await expect(card(secret.id)).toHaveCount(0);
  await expect(card(draft.id)).toHaveCount(0);

  const order = () =>
    page.getByTestId("meme-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-meme-id")));
  // Newest first (the list refetches after the sort click).
  await expect.poll(async () => {
    const ids = await order();
    return ids.indexOf(beta.id) < ids.indexOf(alpha.id);
  }).toBe(true);

  const a = card(alpha.id);
  await a.getByTestId("vote-up").click();
  await expect(a.getByTestId("upvote-count")).toHaveText("1");
  await a.getByTestId("vote-up").click(); // toggle off
  await expect(a.getByTestId("upvote-count")).toHaveText("0");
  await a.getByTestId("vote-up").click();
  await expect(a.getByTestId("upvote-count")).toHaveText("1");

  const b = card(beta.id);
  await b.getByTestId("vote-down").click();
  await expect(b.getByTestId("downvote-count")).toHaveText("1");
  await b.getByTestId("vote-up").click(); // switch sides
  await expect(b.getByTestId("downvote-count")).toHaveText("0");
  await expect(b.getByTestId("upvote-count")).toHaveText("1");
  await b.getByTestId("vote-up").click(); // back to no vote
  await expect(b.getByTestId("upvote-count")).toHaveText("0");
  await b.getByTestId("vote-down").click();
  await expect(b.getByTestId("downvote-count")).toHaveText("1");

  // Votes persist across reload.
  await page.reload();
  await page.getByTestId("period-all").click();
  await page.getByTestId("sort-best").click();
  await expect(card(alpha.id).getByTestId("upvote-count")).toHaveText("1");
  await expect(card(beta.id).getByTestId("downvote-count")).toHaveText("1");
  await expect.poll(async () => {
    const ids = await order();
    return ids.indexOf(alpha.id) < ids.indexOf(beta.id);
  }).toBe(true);

  // Profile: posted memes (incl. private) count; drafts don't.
  await page.goto("/u/gallery-alice");
  await expect(page.getByTestId("stat-meme-count")).toHaveText("3");
  await expect(page.getByTestId("stat-high-score")).toHaveText("1");
  await expect(page.getByTestId("stat-h-score")).toHaveText("1");
  await expect(page.locator(`[data-testid="meme-card"][data-meme-id="${secret.id}"]`)).toHaveCount(0);
});
