import type { PanelLayout } from "./types.ts";

/** Integer source-image pixels, independent of the displayed canvas size. */
export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Repeat a crop right or down. Trailing partial crops are excluded; capacity overflow is never truncated. */
export function propagatedCrops(
  first: PixelCrop,
  direction: PanelLayout,
  gap: number,
  source: { width: number; height: number },
  maxCrops: number,
): PixelCrop[] {
  if (!Number.isSafeInteger(source.width) || source.width < 1 || !Number.isSafeInteger(source.height) || source.height < 1) {
    throw new Error("Source dimensions must be positive whole pixels");
  }
  if (!Number.isSafeInteger(first.x) || first.x < 0 || !Number.isSafeInteger(first.y) || first.y < 0
    || !Number.isSafeInteger(first.width) || first.width < 1 || !Number.isSafeInteger(first.height) || first.height < 1) {
    throw new Error("Draw a rectangle with positive whole-pixel dimensions");
  }
  if (first.x > source.width - first.width || first.y > source.height - first.height) {
    throw new Error("The rectangle must fit inside the source image");
  }
  if (direction !== "horizontal" && direction !== "vertical") throw new Error("Choose horizontal or vertical propagation");
  if (!Number.isSafeInteger(gap) || gap < 0) throw new Error("Gap must be a nonnegative whole number of pixels");
  if (!Number.isSafeInteger(maxCrops) || maxCrops < 1) throw new Error("The image pack has no room for more crops");
  const horizontal = direction === "horizontal";
  const extent = horizontal ? first.width : first.height;
  const remaining = horizontal ? source.width - first.x - extent : source.height - first.y - extent;
  const step = extent + gap;
  const count = 1 + Math.floor(remaining / step);
  if (count > maxCrops) throw new Error(`${count} crops exceed the ${maxCrops} remaining image-pack slots`);
  return Array.from({ length: count }, (_, index) => ({
    x: first.x + (horizontal ? index * step : 0),
    y: first.y + (horizontal ? 0 : index * step),
    width: first.width,
    height: first.height,
  }));
}
