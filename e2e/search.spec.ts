import { apiMeme, apiTemplate, apiUser, inputTagChip, loadAll, memeCard, signIn } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("search: the header box finds memes by template name, template tag, title, or author", async ({ page, request }) => {
  const maker = await apiUser(request, scoped("searchmaker"));
  const other = await apiUser(request, scoped("searchother"));
  const name = scoped("Searchable Template");
  const tag = scoped("searchtag");
  const template = await apiTemplate(request, maker, { name, tags: [tag] });
  // Neither meme carries the template's name or tag itself; both come from the template.
  const mine = await apiMeme(request, maker, { title: scoped("first find"), templateId: template.id });
  const theirs = await apiMeme(request, other, { title: scoped("second find"), templateId: template.id });

  await page.goto("/");
  await signIn(page, scoped("searcher"));
  const results = page.getByTestId("search-results");
  const search = async (q: string) => {
    await page.getByTestId("meme-search").fill(q);
    await page.getByTestId("meme-search").press("Enter");
    await expect(results).toHaveAttribute("data-query", q);
    await loadAll(page);
  };

  for (const q of [name, tag]) {
    await search(q);
    await expect(memeCard(page, mine.id)).toBeVisible();
    await expect(memeCard(page, theirs.id)).toBeVisible();
    await expect(page.getByTestId("meme-search")).toHaveValue(q);
  }
  await search(scoped("second find"));
  await expect(memeCard(page, theirs.id)).toBeVisible();
  await expect(memeCard(page, mine.id)).toHaveCount(0);
  await search(other.username);
  await expect(memeCard(page, theirs.id)).toBeVisible();
  await expect(memeCard(page, mine.id)).toHaveCount(0);
  await search(scoped("no such meme anywhere"));
  await expect(page.getByTestId("meme-card")).toHaveCount(0);
});

test("a new meme starts with its template's tags, and any of them can be removed", async ({ page, request }) => {
  const user = await apiUser(request, scoped("tagcarrier"));
  const template = await apiTemplate(request, user, { name: scoped("Tag carrier"), tags: ["movie", scoped("carried")] });
  await page.goto(`/create?template=${template.id}`);
  await signIn(page, user.username);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");

  const chips = page.getByTestId("tag-input-chip");
  await expect(chips).toHaveCount(template.tags.length);
  for (const slug of template.tags) await expect(inputTagChip(page, slug)).toBeVisible();
  await inputTagChip(page, "movie").getByTestId("tag-input-chip-remove").click();
  await expect(chips).toHaveCount(template.tags.length - 1);
  await expect(inputTagChip(page, "movie")).toHaveCount(0);
});
