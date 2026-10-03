import { drawText, layerStateAt, layoutText, rotatedSize, type TextContext, type TextLayer } from "@memegen/shared";
import type { Ctx2D } from "./canvas.ts";

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
  overflow: boolean;
}

/**
 * Draw every layer visible at `t`, in order (later layers on top). Returns a box for every visible layer,
 * including transparent or empty ones that draw nothing, so they stay selectable.
 */
export function drawLayers(ctx: Ctx2D, layers: readonly TextLayer[], width: number, height: number, t: number): LayerBox[] {
  const textCtx = ctx as TextContext;
  const boxes: LayerBox[] = [];
  for (const layer of layers) {
    const state = layerStateAt(layer, t);
    if (!state.visible) continue;
    const layout = layoutText(textCtx, layer, width, height);
    const bounds = rotatedSize(layout, layer.angle);
    const cx = state.x * width;
    const cy = state.y * height;
    boxes.push({
      layerId: layer.id,
      cx,
      cy,
      width: layout.width,
      height: layout.height,
      angle: layer.angle,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
      opacity: state.opacity,
      overflow: layout.overflow,
    });
    if (state.opacity <= 0 || !layer.text.trim()) continue;
    ctx.save();
    ctx.globalAlpha = state.opacity;
    drawText(textCtx, layer, layout, cx, cy);
    ctx.restore();
  }
  return boxes;
}

/** Frame + layers into `ctx` at `width`×`height` (any size: the frame is scaled, text is laid out in fractions). */
export function composeFrame(
  ctx: Ctx2D,
  frame: CanvasImageSource,
  layers: readonly TextLayer[],
  width: number,
  height: number,
  t: number,
): LayerBox[] {
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, 0, 0, width, height);
  return drawLayers(ctx, layers, width, height, t);
}
