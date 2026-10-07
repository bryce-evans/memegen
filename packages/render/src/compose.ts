import { drawText, layerStateAt, layoutText, rotatedSize, type ImageLayer, type Layer, type TextContext } from "@memegen/shared";
import type { Ctx2D } from "./canvas.ts";
import type { LayerImages } from "./images.ts";

/** Where a visible layer lands — used for hit-testing and selection handles. */
export interface LayerBox {
  layerId: string;
  /** Center in media pixels. */
  cx: number;
  cy: number;
  /** Unrotated box size in media pixels. */
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

/**
 * Draw every layer visible at `t`, in order (later layers on top). Returns a box for every visible layer,
 * including transparent, empty, or still-loading ones that draw nothing, so they stay selectable.
 */
export function drawLayers(ctx: Ctx2D, layers: readonly Layer[], images: LayerImages, width: number, height: number, t: number): LayerBox[] {
  const textCtx = ctx as TextContext;
  const boxes: LayerBox[] = [];
  for (const layer of layers) {
    const state = layerStateAt(layer, t);
    if (!state.visible) continue;
    const cx = state.x * width;
    const cy = state.y * height;
    const image = layer.type === "image" ? images.get(layer.assetId) : undefined;
    const text = layer.type === "text" ? layoutText(textCtx, layer, width, height) : null;
    const size = layer.type === "text" ? text! : imageSize(layer, image, width);
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

/** Frame + layers into `ctx` at `width`×`height` (any size: the frame is scaled, layers are placed in fractions). */
export function composeFrame(
  ctx: Ctx2D,
  frame: CanvasImageSource,
  layers: readonly Layer[],
  images: LayerImages,
  width: number,
  height: number,
  t: number,
): LayerBox[] {
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, 0, 0, width, height);
  return drawLayers(ctx, layers, images, width, height, t);
}
