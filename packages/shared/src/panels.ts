import { newTextLayer } from "./defaults.ts";
import type { UploadLimits } from "./limits.ts";
import type { Panel, PanelLayout, TextLayer } from "./types.ts";

/**
 * Multi-panel layout, shared by the editor preview and the export so both draw the same composition.
 * Pack images are references, never edited: each is drawn whole at its own aspect ratio, only scaled to the strip
 * (vertical: every image is one unit wide; horizontal: every image is one unit tall). Geometry is in those units.
 */
export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelCell {
  text: PanelRect;
  image: PanelRect;
}

export interface PanelGrid {
  width: number;
  height: number;
  /** One per panel, in order. */
  cells: PanelCell[];
}

/** Horizontal layout: height of the caption strip above the images. */
const HORIZONTAL_TEXT_HEIGHT = 0.5;
/**
 * Max caption font size in units (one unit is an image's width in vertical layouts, its height in horizontal ones);
 * captions still shrink to fit their cell. `PanelSet.fontSize` picks it within these bounds.
 */
export const PANEL_FONT_SIZE_DEFAULT = 0.1;
export const PANEL_FONT_SIZE_MIN = 0.03;
export const PANEL_FONT_SIZE_MAX = 0.3;
/** Width of the black rules between panels and between caption and image, in units. */
export const PANEL_RULE_WIDTH = 0.01;
/** One unit in pixels for exports, shrunk when the long edge would pass the image cap. */
export const PANEL_EXPORT_UNIT = 600;

/**
 * Vertical: rows of [caption | image], each row as tall as its image. Horizontal: columns of caption over image,
 * each column as wide as its image. `aspects` are each panel's image height/width, in panel order.
 */
export function panelGrid(layout: PanelLayout, aspects: readonly number[]): PanelGrid {
  const cells: PanelCell[] = [];
  let offset = 0;
  for (const aspect of aspects) {
    if (layout === "vertical") {
      cells.push({ text: { x: 0, y: offset, width: 1, height: aspect }, image: { x: 1, y: offset, width: 1, height: aspect } });
      offset += aspect;
    } else {
      const width = 1 / aspect;
      cells.push({
        text: { x: offset, y: 0, width, height: HORIZONTAL_TEXT_HEIGHT },
        image: { x: offset, y: HORIZONTAL_TEXT_HEIGHT, width, height: 1 },
      });
      offset += width;
    }
  }
  return layout === "vertical" ? { width: 2, height: offset, cells } : { width: offset, height: 1 + HORIZONTAL_TEXT_HEIGHT, cells };
}

/** Export size in pixels: `PANEL_EXPORT_UNIT` per unit, capped so the long edge fits the image cap. */
export function panelExportSize(grid: Pick<PanelGrid, "width" | "height">, limits: UploadLimits): { width: number; height: number } {
  const unit = Math.min(PANEL_EXPORT_UNIT, Math.floor(limits.image.maxDimension / Math.max(grid.width, grid.height)));
  return { width: Math.round(grid.width * unit), height: Math.round(grid.height * unit) };
}

/**
 * A caption as a text layer filling its cell (`layoutText` with the cell as the media): black, unstroked, as typed,
 * at most `fontSize` units tall.
 */
export function panelTextLayer(text: string, cell: PanelRect, fontSize: number): TextLayer {
  return newTextLayer({
    id: "panel-text",
    text,
    fontSize: Math.min(1, fontSize / cell.height),
    color: "#000000",
    strokeWidth: 0,
    maxWidth: 0.9,
    maxHeight: 0.9,
    textStyle: "none",
    x: 0.5,
    y: 0.5,
  });
}

export function newPanel(assetId: string, text = ""): Panel {
  return { id: crypto.randomUUID(), assetId, text };
}
