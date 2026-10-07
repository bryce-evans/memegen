import { drawText, layoutText, PANEL_RULE_WIDTH, panelGrid, panelTextLayer, type PanelGrid, type PanelRect, type PanelSet, type TextContext } from "@memegen/shared";
import { context2d, createCanvas, type Ctx2D } from "./canvas.ts";
import type { ExportResult } from "./export.ts";

/** Pack images by asset id, decoded once (`createImageBitmap`). */
export type PackImages = ReadonlyMap<string, ImageBitmap>;

/** Where a panel (caption + image) lands, in canvas pixels; the editor hit-tests with it. */
export interface PanelBox {
  panelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The caption does not fit its cell even at the minimum font size. */
  overflow: boolean;
}

/** The grid for `set`, each panel sized by its pack image's own aspect ratio (square while an image is missing). */
export function panelSetGrid(set: PanelSet, images: PackImages): PanelGrid {
  return panelGrid(
    set.layout,
    set.panels.map((p) => {
      const image = images.get(p.assetId);
      return image ? image.height / image.width : 1;
    }),
  );
}

const px = (r: PanelRect, unit: number): PanelRect => ({ x: r.x * unit, y: r.y * unit, width: r.width * unit, height: r.height * unit });

/**
 * Draw a multi-panel meme at `width`×`height` (the grid's aspect; any scale): white background, each pack image
 * whole and uncropped in its cell, each caption fit to its cell with the shared text layout, and (unless `set.grid`
 * is off) black rules around cells.
 */
export function composePanels(ctx: Ctx2D, set: PanelSet, images: PackImages, width: number, height: number): PanelBox[] {
  const grid = panelSetGrid(set, images);
  const unit = Math.min(width / grid.width, height / grid.height);
  const textCtx = ctx as TextContext;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const boxes: PanelBox[] = [];
  set.panels.forEach((panel, i) => {
    const cell = grid.cells[i]!;
    const image = images.get(panel.assetId);
    const imageRect = px(cell.image, unit);
    if (image) ctx.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    const textRect = px(cell.text, unit);
    const layer = panelTextLayer(panel.text, cell.text, set.fontSize);
    const layout = layoutText(textCtx, layer, textRect.width, textRect.height);
    if (panel.text.trim()) drawText(textCtx, layer, layout, textRect.x + textRect.width / 2, textRect.y + textRect.height / 2);
    const x = Math.min(imageRect.x, textRect.x);
    const y = Math.min(imageRect.y, textRect.y);
    boxes.push({
      panelId: panel.id,
      x,
      y,
      width: Math.max(imageRect.x + imageRect.width, textRect.x + textRect.width) - x,
      height: Math.max(imageRect.y + imageRect.height, textRect.y + textRect.height) - y,
      overflow: layout.overflow,
    });
  });
  // Rules last so images never cover them; outer edges show half the width, inner edges the full width.
  if (set.grid) {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.max(1, PANEL_RULE_WIDTH * unit);
    for (const cell of grid.cells) {
      for (const r of [px(cell.text, unit), px(cell.image, unit)]) ctx.strokeRect(r.x, r.y, r.width, r.height);
    }
  }
  ctx.restore();
  return boxes;
}

/** Render a multi-panel meme to JPEG at `size` (see `panelExportSize`). */
export async function exportPanels(set: PanelSet, images: PackImages, size: { width: number; height: number }): Promise<ExportResult> {
  const canvas = createCanvas(size.width, size.height);
  composePanels(context2d(canvas), set, images, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  return { blob, mime: "image/jpeg", extension: ".jpg" };
}
