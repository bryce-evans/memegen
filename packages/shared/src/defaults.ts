import type { TextLayer } from "./types.ts";

export function newTextLayer(partial: Partial<TextLayer> = {}): TextLayer {
  return {
    id: crypto.randomUUID(),
    text: "TOP TEXT",
    fontAssetId: null,
    fontSize: 1 / 9,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: 0.08,
    align: "center",
    maxWidth: 0.96,
    maxHeight: 0.2,
    textStyle: "upper",
    angle: 0,
    x: 0.5,
    y: 0.1,
    opacity: 1,
    start: null,
    end: null,
    keyframes: [],
    ...partial,
  };
}

/** The classic two-box meme: captions near the top and bottom edges. */
export function topBottomLayers(top = "TOP TEXT", bottom = "BOTTOM TEXT", fontAssetId: string | null = null): TextLayer[] {
  return [newTextLayer({ text: top, y: 0.1, fontAssetId }), newTextLayer({ text: bottom, y: 0.9, fontAssetId })];
}
