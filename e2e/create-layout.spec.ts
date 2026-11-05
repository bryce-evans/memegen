import { expect, scoped, test } from "./test.ts";
import { apiTemplate, apiUser, openFeed, signIn } from "./helpers.ts";

for (const width of [1600, 390]) {
  test(`Create uses gallery width without distorting its preview at ${width}px`, async ({ page, request }) => {
    const username = scoped(`create-width-${width}`);
    const owner = await apiUser(request, username);
    const template = await apiTemplate(request, owner, { name: scoped(`create-width-image-${width}`) });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await signIn(page, username);
    if (await page.getByTestId("gallery-menu").isVisible()) await page.getByTestId("gallery-menu").click();
    await openFeed(page, { feed: "recent" });
    const gallery = (await page.getByTestId("meme-feed").boundingBox())!;
    await page.getByTestId("nav-create").click();
    const start = page.getByTestId("create-start");
    await expect(start).toBeVisible();
    const creator = page.getByTestId("ai-creator");
    await creator.getByTestId("ai-template-search").fill(template.name);
    await creator.locator(`[data-testid="ai-template-option"][data-template-id="${template.id}"]`).click();
    const canvas = creator.getByTestId("ai-canvas");
    await expect(canvas).toHaveAttribute("data-template-id", template.id);
    await expect(canvas).toHaveAttribute("data-ready", "true");
    const create = (await start.boundingBox())!;
    expect(create.x).toBeCloseTo(gallery.x, 0);
    expect(create.width).toBeCloseTo(gallery.width, 0);
    const preview = (await canvas.boundingBox())!;
    expect(preview.width / preview.height).toBeCloseTo(template.asset.width! / template.asset.height!, 2);
    expect(preview.x).toBeGreaterThanOrEqual(create.x);
    expect(preview.x + preview.width).toBeLessThanOrEqual(create.x + create.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("a late random template never replaces the focused search field", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/templates/count", async (route) => { await pending; await route.continue(); });
  await page.goto("/create");
  await signIn(page, scoped("create-focused-search"));
  const creator = page.getByTestId("ai-creator");
  const search = creator.getByTestId("ai-template-search");
  await search.focus();
  const randomTemplate = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/templates" && url.searchParams.get("limit") === "1" && url.searchParams.has("offset");
  });
  release();
  await randomTemplate;
  await expect(creator).toHaveAttribute("aria-busy", "false");
  await search.pressSequentially("my intended search");
  await expect(search).toHaveValue("my intended search");
});
