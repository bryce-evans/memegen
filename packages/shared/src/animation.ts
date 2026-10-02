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
