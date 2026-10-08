import { layoutText, type TextContext, type TextLayout } from "./text.ts";
import type { Layer, TextLayer } from "./types.ts";

/**
 * Top section: a white band above the media holding one text layer (the layer with `topSection`, kept first), like a
 * caption meme. The band lives in the layers themselves, so memes, template defaults, the editor, and every exporter
 * get it without a separate field.
 *
 * `topSection.height` is the band for one line of text. The text's font size is a fraction of that height (so it
 * never depends on the band it sizes), it wraps at its box width and is never shrunk for height: every line past the
 * first makes the band that much taller, so the padding around the text stays fixed. The text's x/y are fractions of
 * the actual band.
 */

/** One-line band height as a fraction of the media width. */
export const TOP_SECTION_HEIGHT_DEFAULT = 0.20;
export const TOP_SECTION_HEIGHT_MIN = 0.1;
export const TOP_SECTION_HEIGHT_MAX = 1;
/** Default font size of the band's text, as a fraction of the one-line band height. */
export const TOP_SECTION_FONT_SIZE_DEFAULT = 0.15;
export const TOP_SECTION_BACKGROUND = "#ffffff";

/**
 * Lowest anchor y. A layer on the media may sit in the band above it, which is `band / mediaHeight` media heights
 * tall: up to the media's aspect ratio for a one-line band of full width, plus any extra lines.
 */
export const ANCHOR_Y_MIN = -10;

/** The top section's text layer, or null when the meme has no top section. */
export function topSectionLayer(layers: readonly Layer[]): TextLayer | null {
  return layers.find((l): l is TextLayer => l.type === "text" && l.topSection !== undefined) ?? null;
}

/** Even pixel count, so video encoders accept the frame. */
const even = (px: number) => 2 * Math.round(px / 2);

/**
 * The top section's text laid out on a canvas `width` px wide, and the band it needs: the one-line height plus the
 * height of every extra line.
 */
export function layoutTopSection(ctx: TextContext, layer: TextLayer, width: number): { layout: TextLayout; bandPx: number } {
  const basePx = even((layer.topSection?.height ?? 0) * width);
  const layout = layoutText(ctx, layer, width, basePx);
  const oneLine = Math.ceil(layout.lineHeightPx) + layout.pad * 2;
  return { layout, bandPx: even(basePx + Math.max(0, layout.height - oneLine)) };
}

/** Band height in pixels on a canvas `width` px wide (even); 0 without a top section. */
export function topSectionPx(ctx: TextContext, layers: readonly Layer[], width: number): number {
  const layer = topSectionLayer(layers);
  return layer ? layoutTopSection(ctx, layer, width).bandPx : 0;
}

/** Full canvas height for media `mediaHeight` px tall on a canvas `width` px wide: the band plus the media. */
export function composedHeight(ctx: TextContext, layers: readonly Layer[], width: number, mediaHeight: number): number {
  return mediaHeight + topSectionPx(ctx, layers, width);
}

/** The rectangle a layer's x/y fractions refer to on a `width`×`height` canvas whose band is `bandPx` tall. */
export interface LayerArea {
  top: number;
  width: number;
  height: number;
}

export function layerArea(layer: Layer, width: number, height: number, bandPx: number): LayerArea {
  if (layer.type === "text" && layer.topSection) return { top: 0, width, height: bandPx };
  return { top: bandPx, width, height: height - bandPx };
}

/** Canvas above a layer's area, in heights of that area: the band for layers on the media, 0 for the band's text. */
export function layerAbove(layer: Layer, width: number, height: number, bandPx: number): number {
  const area = layerArea(layer, width, height, bandPx);
  return area.height > 0 ? area.top / area.height : 0;
}
