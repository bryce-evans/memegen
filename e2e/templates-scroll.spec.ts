import { apiUpload, apiUser } from "./helpers.ts";
import { expect, scoped, test } from "./test.ts";

test("templates: the create page loads more matches as the end of the list scrolls into view", async ({ page, request }) => {
  // Unique per project and per run, so the search matches exactly these templates.
  const prefix = scoped(`Scroll ${Date.now().toString(36)}`);
  const total = 30; // more than one page (24)
  const user = await apiUser(request, scoped("scroller"));
  const asset = await apiUpload(request, user, "still.png");
  for (let i = 0; i < total; i++) {
    const res = await request.post("/api/templates", {
      headers: { "x-user-id": user.id },
      data: { name: `${prefix} ${String(i).padStart(2, "0")}`, assetId: asset.id },
    });
    expect(res.status(), await res.text()).toBe(201);
  }

  await page.goto("/create");
  await expect(page.getByTestId("create-mode-search")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("template-search").fill(prefix);
  const matches = page.getByTestId("template-card").filter({ hasText: prefix });
  await expect(matches.first()).toBeVisible();

  const sentinel = page.getByTestId("load-more-sentinel");
  await expect
    .poll(
      async () => {
        if ((await sentinel.count()) > 0) await sentinel.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => undefined);
        return matches.count();
      },
      { timeout: 30_000 },
    )
    .toBe(total);
  await expect(page.getByTestId("template-card")).toHaveCount(total);
  await expect(sentinel).toHaveCount(0);
  await expect(page.getByTestId("load-more")).toHaveCount(0);
});
