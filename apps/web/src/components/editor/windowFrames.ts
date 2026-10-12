import { frameIndexAt } from "@memegen/render";
import { setWindow, type Layer, type WindowEdge } from "@memegen/shared";

/**
 * A layer's visibility window as frame indexes (0-based): the first and last frame it shows on. A null edge covers
 * the clip's first/last frame. `end` stores the start time of the last shown frame, so that frame shows for its
 * whole duration (`isVisibleAt`).
 */
export function windowFrames(layer: Pick<Layer, "start" | "end">, times: readonly number[]): Record<WindowEdge, number> {
  return {
    start: layer.start === null ? 0 : frameIndexAt(times, layer.start),
    end: layer.end === null ? times.length - 1 : frameIndexAt(times, layer.end),
  };
}

/**
 * Move one edge of `layer`'s window to frame `index`: clamped so the window can't invert (start ≤ end) or leave the
 * clip, and stored as that frame's start time, or null on the clip's first/last frame ("from the start"/"until the
 * end"). Returns the clamped frame (to show it) and the update to apply to the layer's latest state.
 */
export function moveEdge(
  layer: Pick<Layer, "start" | "end">,
  edge: WindowEdge,
  index: number,
  times: readonly number[],
): { index: number; update: (layer: Layer) => Layer } {
  const { start, end } = windowFrames(layer, times);
  const i = edge === "start" ? Math.min(Math.max(index, 0), end) : Math.min(Math.max(index, start), times.length - 1);
  const unbounded = edge === "start" ? i === 0 : i === times.length - 1;
  return { index: i, update: (l) => setWindow(l, edge, unbounded ? null : times[i]!) };
}
