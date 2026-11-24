import { readFileSync } from "node:fs";
import { ASSETS_QUERY_MAX_LIMIT, newTextLayer, type Asset, type Meme, type Page } from "@memegen/shared";
import { expect, scoped, test } from "./test.ts";
import { apiGet, apiTemplate, apiUser, fixture, memeIdFromUrl, signIn, stagePixels } from "./helpers.ts";
import { E2E_ENV } from "./environment.ts";

test("text style presets render without changing captions or placement; advanced edits survive saving", async ({ page, request }) => {
  const username = scoped("stylist");
  const user = await apiUser(request, username);
  const fonts: Record<string, string> = {};
  const existingFonts = await apiGet<Page<Asset>>(request, `/storage/assets?kind=font&limit=${ASSETS_QUERY_MAX_LIMIT}`, user);
  for (const [file, name] of [["Impact.ttf", "Impact"], ["NotoSans-Bold.ttf", "Noto Sans Bold"]] as const) {
    const existing = existingFonts.items.find((font) => font.name === name);
    if (existing) {
      fonts[name] = existing.id;
      continue;
    }
    const response = await request.post(`${E2E_ENV.STORAGE_URL}/assets`, {
      headers: { "x-internal-token": E2E_ENV.INTERNAL_TOKEN },
      multipart: { file: { name: file, mimeType: "font/ttf", buffer: readFileSync(fixture(file)) }, name },
    });
    expect(response.status()).toBe(201);
    const asset = await response.json() as Asset;
    fonts[name] = asset.id;
  }
  const styles = [
    { id: "impact", fontAssetId: fonts.Impact!, color: "#ffffff", strokeWidth: 0.08, textStyle: "upper" },
    { id: "caption", fontAssetId: null, systemFont: "arial-bold", color: "#f5f2a6", strokeWidth: 0.05, textStyle: "none" },
    { id: "bright-yellow", fontAssetId: null, systemFont: "arial-bold", color: "#ffff00", strokeWidth: 0.05, textStyle: "none" },
    { id: "greentext", fontAssetId: null, systemFont: "arial", color: "#789922", strokeWidth: 0, textStyle: "none" },
    { id: "white", fontAssetId: fonts["Noto Sans Bold"]!, color: "#ffffff", strokeWidth: 0.05, textStyle: "none" },
    { id: "black", fontAssetId: fonts["Noto Sans Bold"]!, color: "#000000", strokeWidth: 0, textStyle: "none" },
  ];
  const layers = styles.map((style, i) => newTextLayer({
    text: `Keep My ${style.id} Caption`,
    x: 0.5, y: 0.1 + i * 0.15, maxWidth: 0.8, maxHeight: 0.18,
    fontSize: 0.07, angle: 3, opacity: 0.9, color: "#ff00ff", strokeWidth: 0.13, textStyle: "mock",
  }));
  const template = await apiTemplate(request, user, { name: "Preset styles", defaultLayers: layers });
  await page.goto(`/create?template=${template.id}`);
  await signIn(page, username);
  await expect(page.getByTestId("stage-canvas")).toHaveAttribute("data-ready", "true");

  for (const [i, style] of styles.entries()) {
    const item = page.getByTestId("layer-item").nth(i);
    await expect(item.getByTestId("layer-settings")).toHaveCount(0);
    await expect(item.getByTestId(`layer-preset-${style.id}`)).toHaveCount(0);
    await item.getByTestId("layer-settings-toggle").click();
    const before = await stagePixels(page);
    await item.getByTestId(`layer-preset-${style.id}`).click();
    await expect.poll(() => stagePixels(page)).not.toBe(before);
    await expect(item.getByTestId("layer-text")).toHaveValue(layers[i]!.text);
    await expect(item.getByTestId(`layer-preset-${style.id}`)).toHaveAttribute("aria-pressed", "true");
    await expect(item.getByTestId("layer-font")).toHaveValue(style.systemFont ?? style.fontAssetId!);
    await expect(item.getByTestId("font-upload")).toHaveCount(0);
    await expect(item.getByTestId("layer-color")).toHaveValue(style.color);
    await expect(item.getByTestId("layer-stroke-color")).toHaveValue("#000000");
    await expect(item.getByTestId("layer-stroke-width")).toHaveValue(String(style.strokeWidth * 100));
    await expect(item.getByTestId("layer-style")).toHaveValue(style.textStyle);
    expect(Number(await item.getByTestId("layer-font-size").inputValue())).toBeCloseTo(7);
    await expect(item.getByTestId("text-box-width")).toHaveCount(0);
    await expect(item.getByTestId("text-box-height")).toHaveCount(0);
    await expect(item.getByTestId("layer-angle")).toHaveCount(0);
    await item.getByTestId("layer-settings-toggle").click();
    await expect(item.getByTestId("layer-settings")).toHaveCount(0);
  }

  // The pencil is a disclosure, not a mode that overwrites custom settings on close.
  const last = page.getByTestId("layer-item").last();
  await last.getByTestId("layer-settings-toggle").click();
  await last.getByTestId("layer-color").fill("#123456");
  await last.getByTestId("layer-stroke-width").fill("12");
  await last.getByTestId("layer-style").selectOption("lower");
  await expect(last.getByTestId("layer-preset-black")).toHaveAttribute("aria-pressed", "false");
  await last.getByTestId("layer-settings-toggle").click();
  await last.getByTestId("layer-settings-toggle").click();
  await expect(last.getByTestId("layer-color")).toHaveValue("#123456");
  await expect(last.getByTestId("layer-stroke-width")).toHaveValue("12");
  await expect(last.getByTestId("layer-style")).toHaveValue("lower");

  await page.getByTestId("meme-title").fill("Preset rendering and custom styles");
  await page.getByTestId("save-draft").click();
  const id = await memeIdFromUrl(page);
  const saved = await apiGet<Meme>(request, `/api/memes/${id}`, user);
  expect(saved.layers.map(({ id: _id, ...layer }) => layer)).toEqual(layers.map(({ id: _id, ...layer }, i) => {
    const { id: _presetId, ...style } = styles[i]!;
    return { ...layer, ...style, opacity: 1, strokeColor: "#000000", ...(i === styles.length - 1 ? { color: "#123456", strokeWidth: 0.12, textStyle: "lower" } : {}) };
  }));
});
