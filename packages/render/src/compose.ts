import { drawText, layerStateAt, layoutText, rotatedSize, type TextContext, type TextLayer } from "@memegen/shared";
import type { Ctx2D } from "./canvas.ts";

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

/** Where each visible layer lands at time `t` — used for hit-testing and selection handles. */
export function layerBoxes(ctx: Ctx2D, layers: readonly TextLayer[], width: number, height: number, t: number): LayerBox[] {
  const out: LayerBox[] = [];
  for (const layer of layers) {
    const state = layerStateAt(layer, t);
    if (!state.visible) continue;
    const layout = layoutText(ctx as TextContext, layer, width, height);
    const bounds = rotatedSize(layout, layer.angle);
    out.push({
      layerId: layer.id,
      cx: state.x * width,
      cy: state.y * height,
      width: layout.width,
      height: layout.height,
      angle: layer.angle,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
      opacity: state.opacity,
      overflow: layout.overflow,
    });
  }
  return out;
}

/** Draw every layer visible at `t`, in order (later layers on top). */
export function drawLayers(ctx: Ctx2D, layers: readonly TextLayer[], width: number, height: number, t: number): void {
  const textCtx = ctx as TextContext;
  for (const layer of layers) {
    const state = layerStateAt(layer, t);
    if (!state.visible || state.opacity <= 0 || !layer.text.trim()) continue;
    const layout = layoutText(textCtx, layer, width, height);
    ctx.save();
    ctx.globalAlpha = state.opacity;
    drawText(textCtx, layer, layout, state.x * width, state.y * height);
    ctx.restore();
  }
}

/** Frame + layers into `ctx` at `width`×`height` (any size: the frame is scaled, text is laid out in fractions). */
export function composeFrame(
  ctx: Ctx2D,
  frame: CanvasImageSource,
  layers: readonly TextLayer[],
  width: number,
  height: number,
  t: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, 0, 0, width, height);
  drawLayers(ctx, layers, width, height, t);
}
