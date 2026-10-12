import {
  composedHeight,
  drawText,
  layerArea,
  layerStateAt,
  layoutText,
  layoutTopSection,
  rotatedSize,
  TOP_SECTION_BACKGROUND,
  topSectionLayer,
  type ImageLayer,
  type Layer,
  type TextContext,
  type TextLayer,
  type TextLayout,
} from "@memegen/shared";
import type { Ctx2D } from "./canvas.ts";
import type { AssetImages } from "./images.ts";

/** Where a visible layer lands — used for hit-testing and selection handles. */
export interface LayerBox {
  layerId: string;
  /** Center in canvas pixels. */
  cx: number;
  cy: number;
  /** Unrotated box size in canvas pixels. */
  width: number;
  height: number;
  angle: number;
  /** Axis-aligned bounds after rotation. */
  boundsWidth: number;
  boundsHeight: number;
  opacity: number;
  /** Text that does not fit its box even at the minimum size; always false for images. */
  overflow: boolean;
}

/** An image layer's drawn size: `width` of the media width, height from the image's aspect (square until loaded). */
function imageSize(layer: ImageLayer, image: ImageBitmap | undefined, mediaW: number): { width: number; height: number } {
  const width = layer.width * mediaW;
  return { width, height: image ? (width * image.height) / image.width : width };
}

/** The top section's text and its layout on this canvas, laid out once per frame; null without a top section. */
type Section = { layer: TextLayer; layout: TextLayout; bandPx: number } | null;

/**
 * Draw every layer visible at `t`, in order (later layers on top), on a `width`×`height` canvas (the top section's
 * band, if any, then the media). Each layer is placed in its own area: the top section's text in the band, the rest
 * in the media. Returns a box for every visible layer, including transparent, empty, or still-loading ones that draw
 * nothing, so they stay selectable.
 */
function drawLayers(
  ctx: Ctx2D,
  layers: readonly Layer[],
  images: AssetImages,
  section: Section,
  width: number,
  height: number,
  t: number,
): LayerBox[] {
  const textCtx = ctx as TextContext;
  const boxes: LayerBox[] = [];
  const band = section?.bandPx ?? 0;
  for (const layer of layers) {
    const state = layerStateAt(layer, t);
    if (!state.visible) continue;
    const area = layerArea(layer, width, height, band);
    const cx = state.x * area.width;
    const cy = area.top + state.y * area.height;
    const image = layer.type === "image" ? images.get(layer.assetId) : undefined;
    // The band's text is sized from the one-line band, not the (text-grown) band it sits in.
    const text = layer.type !== "text" ? null : layer === section?.layer ? section.layout : layoutText(textCtx, layer, area.width, area.height);
    const size = layer.type === "text" ? text! : imageSize(layer, image, area.width);
    const bounds = rotatedSize(size, layer.angle);
    boxes.push({
      layerId: layer.id,
      cx,
      cy,
      width: size.width,
      height: size.height,
      angle: layer.angle,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
      opacity: state.opacity,
      overflow: text?.overflow ?? false,
    });
    if (state.opacity <= 0) continue;
    if (layer.type === "text") {
      if (!layer.text.trim()) continue;
      ctx.save();
      ctx.globalAlpha = state.opacity;
      drawText(textCtx, layer, text!, cx, cy);
      ctx.restore();
    } else if (image) {
      ctx.save();
      ctx.globalAlpha = state.opacity;
      ctx.translate(cx, cy);
      if (layer.angle) ctx.rotate((layer.angle * Math.PI) / 180);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, -size.width / 2, -size.height / 2, size.width, size.height);
      ctx.restore();
    }
  }
  return boxes;
}

/** Draws the media into a rectangle, for sources `drawImage` can't take (a mediabunny `VideoSample` draws itself). */
export type DrawMedia = (ctx: Ctx2D, x: number, y: number, width: number, height: number) => void;

/**
 * The top section's white band (if any) and the frame under it, then the layers, into `ctx` at `width`×`height`, the
 * whole canvas (`composedSize` sizes it; any scale works: the frame is scaled, layers are placed in fractions). The
 * band's text is laid out once and shared by the band and the layers.
 */
export function composeFrame(
  ctx: Ctx2D,
  frame: CanvasImageSource | DrawMedia,
  layers: readonly Layer[],
  images: AssetImages,
  width: number,
  height: number,
  t: number,
): LayerBox[] {
  ctx.clearRect(0, 0, width, height);
  const layer = topSectionLayer(layers);
  const section: Section = layer ? { layer, ...layoutTopSection(ctx as TextContext, layer, width) } : null;
  const band = section?.bandPx ?? 0;
  if (band > 0) {
    ctx.fillStyle = TOP_SECTION_BACKGROUND;
    ctx.fillRect(0, 0, width, band);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (typeof frame === "function") frame(ctx, 0, band, width, height - band);
  else ctx.drawImage(frame, 0, band, width, height - band);
  return drawLayers(ctx, layers, images, section, width, height, t);
}

let measuring: OffscreenCanvasRenderingContext2D | null = null;

/**
 * Canvas size for `media` drawn `width` px wide: the media scaled to that width (`mediaHeight`) plus the top section's
 * band, whose height depends on how its text wraps at that width, so it is measured there (fonts must be loaded for an
 * exact size). The stage, the preview, and every export size their canvas with it.
 */
export function composedSize(
  layers: readonly Layer[],
  media: { width: number; height: number },
  width: number,
): { width: number; height: number; mediaHeight: number } {
  measuring ??= new OffscreenCanvas(1, 1).getContext("2d")!;
  const mediaHeight = Math.max(1, Math.round((width * media.height) / media.width));
  return { width, height: composedHeight(measuring as unknown as TextContext, layers, width, mediaHeight), mediaHeight };
}
