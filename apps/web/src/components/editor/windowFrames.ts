import { frameIndexAt } from "@memegen/render";
import { setWindow, type TextLayer, type WindowEdge } from "@memegen/shared";

/**
 * A layer's visibility window as frame indexes (0-based): the first and last frame it shows on. A null edge covers
 * the clip's first/last frame. `end` stores the start time of the last shown frame, so that frame shows for its
 * whole duration (`isVisibleAt`).
 */
export function windowFrames(layer: Pick<TextLayer, "start" | "end">, times: readonly number[]): Record<WindowEdge, number> {
  return {
    start: layer.start === null ? 0 : frameIndexAt(times, layer.start),
    end: layer.end === null ? times.length - 1 : frameIndexAt(times, layer.end),
  };
}

/** Clamp a frame index for one edge so the window can't invert (start ≤ end) or leave the clip. */
export function clampEdgeFrame(layer: Pick<TextLayer, "start" | "end">, edge: WindowEdge, index: number, times: readonly number[]): number {
  const { start, end } = windowFrames(layer, times);
  return edge === "start" ? Math.min(Math.max(index, 0), end) : Math.min(Math.max(index, start), times.length - 1);
}

/** Put one edge on frame `index` (already clamped); the clip's first/last frame stores null ("from the start"/"until the end"). */
export function setEdgeFrame(layer: TextLayer, edge: WindowEdge, index: number, times: readonly number[]): TextLayer {
  const unbounded = edge === "start" ? index === 0 : index === times.length - 1;
  return setWindow(layer, edge, unbounded ? null : times[index]!);
}
