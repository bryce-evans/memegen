import type { Keyframe, TextLayer } from "./types.ts";

export interface LayerState {
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
}

/** Linear interpolation of one keyframe channel; clamps outside the keyframe range. */
export function interpolate(keyframes: readonly Keyframe[], t: number, key: "x" | "y" | "opacity"): number {
  const first = keyframes[0];
  if (!first) throw new Error("interpolate needs at least one keyframe");
  if (t <= first.t) return first[key];
  for (let i = 1; i < keyframes.length; i++) {
    const b = keyframes[i]!;
    if (t < b.t) {
      const a = keyframes[i - 1]!;
      return a[key] + ((b[key] - a[key]) * (t - a.t)) / (b.t - a.t);
    }
  }
  return keyframes[keyframes.length - 1]![key];
}

export function isVisibleAt(layer: Pick<TextLayer, "start" | "end">, t: number): boolean {
  return (layer.start === null || t >= layer.start) && (layer.end === null || t <= layer.end);
}

export function layerStateAt(layer: TextLayer, t: number): LayerState {
  const visible = isVisibleAt(layer, t);
  if (layer.keyframes.length === 0) {
    return { x: layer.x, y: layer.y, opacity: layer.opacity, visible };
  }
  return {
    x: interpolate(layer.keyframes, t, "x"),
    y: interpolate(layer.keyframes, t, "y"),
    opacity: interpolate(layer.keyframes, t, "opacity"),
    visible,
  };
}

/** Insert or replace the keyframe at time `t` (within `epsilon`), keeping order. */
export function upsertKeyframe(keyframes: readonly Keyframe[], kf: Keyframe, epsilon = 1e-4): Keyframe[] {
  const rest = keyframes.filter((k) => Math.abs(k.t - kf.t) > epsilon);
  return [...rest, kf].sort((a, b) => a.t - b.t);
}

/** Keep anchors near the media; the schema accepts -1..2. */
export function clampAnchor(v: number): number {
  return Math.min(1.5, Math.max(-0.5, v));
}

export type Placement = Partial<Pick<Keyframe, "x" | "y" | "opacity">>;

/** Move/fade a layer at time `t`: static layers change their anchor, animated ones get a keyframe at `t`. */
export function placeAt(layer: TextLayer, t: number, patch: Placement): TextLayer {
  const state = layerStateAt(layer, t);
  const x = patch.x === undefined ? state.x : clampAnchor(patch.x);
  const y = patch.y === undefined ? state.y : clampAnchor(patch.y);
  const opacity = patch.opacity ?? state.opacity;
  if (layer.keyframes.length === 0) return { ...layer, x, y, opacity };
  return { ...layer, keyframes: upsertKeyframe(layer.keyframes, { t, x, y, opacity }) };
}

/** Keyframe the layer's current state at `t`. */
export function addKeyframeAt(layer: TextLayer, t: number): TextLayer {
  const { x, y, opacity } = layerStateAt(layer, t);
  return { ...layer, keyframes: upsertKeyframe(layer.keyframes, { t, x, y, opacity }) };
}

/** Drop one keyframe; removing the last one keeps its state as the static position. */
export function removeKeyframe(layer: TextLayer, index: number): TextLayer {
  const kf = layer.keyframes[index];
  if (!kf) return layer;
  if (layer.keyframes.length === 1) return { ...layer, keyframes: [], x: kf.x, y: kf.y, opacity: kf.opacity };
  return { ...layer, keyframes: layer.keyframes.filter((_, i) => i !== index) };
}

/** Remove keyframes and the visibility window, keeping the state at `t` as the static position. */
export function clearAnimation(layer: TextLayer, t: number): TextLayer {
  const { x, y, opacity } = layerStateAt(layer, t);
  return { ...layer, keyframes: [], start: null, end: null, x, y, opacity };
}

export type WindowEdge = "start" | "end";

/** Set (or clear with null) one edge of the visibility window; the other edge is cleared if it would invert it. */
export function setWindow(layer: TextLayer, edge: WindowEdge, value: number | null): TextLayer {
  if (edge === "start") {
    return { ...layer, start: value, end: value !== null && layer.end !== null && layer.end < value ? null : layer.end };
  }
  return { ...layer, end: value, start: value !== null && layer.start !== null && layer.start > value ? null : layer.start };
}
