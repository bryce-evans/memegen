import type { ImageLayer, Layer, TextLayer } from "./types.ts";

export function newTextLayer(partial: Partial<Omit<TextLayer, "type">> = {}): TextLayer {
  return {
    type: "text",
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

/** An image layer centered on the media, `width` (fraction of media width) wide. */
export function newImageLayer(assetId: string, partial: Partial<Omit<ImageLayer, "type" | "assetId">> = {}): ImageLayer {
  return {
    type: "image",
    id: crypto.randomUUID(),
    assetId,
    width: 0.4,
    angle: 0,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    start: null,
    end: null,
    keyframes: [],
    ...partial,
  };
}

/** The classic two-box meme: captions near the top and bottom edges. */
export function topBottomLayers(top = "TOP TEXT", bottom = "BOTTOM TEXT", fontAssetId: string | null = null): TextLayer[] {
  return [
    newTextLayer({ name: "Top text", text: top, y: 0.1, fontAssetId }),
    newTextLayer({ name: "Bottom text", text: bottom, y: 0.9, fontAssetId }),
  ];
}

/** A layer's editor label: its name, or "Text N"/"Image N" by position (1-based) for layers stored before names. */
export function layerLabel(layer: Pick<Layer, "name"> & { type?: Layer["type"] }, index: number): string {
  return layer.name || `${layer.type === "image" ? "Image" : "Text"} ${index + 1}`;
}
