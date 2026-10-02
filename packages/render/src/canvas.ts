export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

export function context2d(canvas: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  const ctx = canvas.getContext("2d", opts) as Ctx2D | null;
  if (!ctx) throw new Error("2D canvas is not available");
  return ctx;
}

/** Let the browser paint/handle input during long synchronous loops. */
export function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
