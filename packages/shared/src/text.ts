import type { TextLayer, TextStyle } from "./types.ts";

/**
 * Text layout + drawing for meme layers. The editor preview and the exporter both
 * call these, so what you see is what gets encoded.
 */
export interface TextContext {
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
}

export const FALLBACK_FONT_FAMILY = "sans-serif";
export const LINE_HEIGHT = 1.15;
export const MIN_FONT_PX = 6;
/** The top section's text is Arial unless the layer picks a font asset. */
export const TOP_SECTION_FONT_FAMILY = "Arial, Helvetica, sans-serif";

/** CSS family name a font asset is registered under via FontFace. */
export function fontFamilyFor(fontAssetId: string | null): string {
  return fontAssetId ? `mg-${fontAssetId}` : FALLBACK_FONT_FAMILY;
}

/** Canvas font for an asset, or for `fallback` (a CSS family list, used as is) when there is none. */
export function cssFont(fontAssetId: string | null, fontPx: number, fallback = FALLBACK_FONT_FAMILY): string {
  return fontAssetId ? `${fontPx}px "${fontFamilyFor(fontAssetId)}"` : `${fontPx}px ${fallback}`;
}

/** Deterministic "sPoNgEbOb" casing: alternates per letter, ignoring non-letters. */
export function mockCase(text: string): string {
  let upper = false;
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (lower === ch.toUpperCase()) {
      out += ch;
      continue;
    }
    out += upper ? ch.toUpperCase() : lower;
    upper = !upper;
  }
  return out;
}

export function applyTextStyle(text: string, style: TextStyle): string {
  switch (style) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "mock":
      return mockCase(text);
    case "none":
      return text;
  }
}

export interface TextLayout {
  lines: string[];
  fontPx: number;
  strokePx: number;
  lineHeightPx: number;
  /** Inset of the text from each box edge, so the stroke is not clipped. */
  pad: number;
  /** Unrotated box including `pad` on every side. */
  width: number;
  height: number;
  font: string;
  /** True when even MIN_FONT_PX overflows the box. */
  overflow: boolean;
}

function wrapLines(ctx: TextContext, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxW) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function measure(ctx: TextContext, layer: TextLayer, text: string, fontPx: number, boxW: number): TextLayout {
  // The top section's text defaults to Arial; every other layer to the fallback family.
  const font = cssFont(layer.fontAssetId, fontPx, layer.topSection ? TOP_SECTION_FONT_FAMILY : FALLBACK_FONT_FAMILY);
  ctx.font = font;
  const strokePx = layer.strokeWidth * fontPx;
  const pad = Math.ceil(strokePx) + 1;
  const lines = wrapLines(ctx, text, Math.max(1, boxW - pad * 2));
  const textW = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
  const lineHeightPx = fontPx * LINE_HEIGHT;
  return {
    lines,
    fontPx,
    strokePx,
    lineHeightPx,
    pad,
    width: Math.ceil(textW) + pad * 2,
    height: Math.ceil(lines.length * lineHeightPx) + pad * 2,
    font,
    overflow: false,
  };
}

/**
 * Largest font size (<= layer.fontSize) whose wrapped text fits the layer box. The top section's text only has to fit
 * the width: its band grows with every line (`layoutTopSection`).
 */
export function layoutText(ctx: TextContext, layer: TextLayer, mediaW: number, mediaH: number): TextLayout {
  const text = applyTextStyle(layer.text, layer.textStyle);
  const boxW = layer.maxWidth * mediaW;
  const boxH = layer.topSection ? Infinity : layer.maxHeight * mediaH;
  let fontPx = Math.max(MIN_FONT_PX, Math.round(layer.fontSize * mediaH));
  for (;;) {
    const layout = measure(ctx, layer, text, fontPx, boxW);
    if ((layout.width <= boxW && layout.height <= boxH) || fontPx <= MIN_FONT_PX) {
      return { ...layout, overflow: layout.width > boxW || layout.height > boxH };
    }
    fontPx = Math.max(MIN_FONT_PX, Math.floor(fontPx * 0.92));
  }
}

/** Axis-aligned size of the layout box after rotation. */
export function rotatedSize(layout: Pick<TextLayout, "width" | "height">, angleDeg: number): { width: number; height: number } {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return {
    width: Math.ceil(layout.width * c + layout.height * s),
    height: Math.ceil(layout.width * s + layout.height * c),
  };
}

/** Draw a laid-out layer with its box centered on (cx, cy). Caller sets globalAlpha. */
export function drawText(ctx: TextContext, layer: TextLayer, layout: TextLayout, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (layer.angle) ctx.rotate((layer.angle * Math.PI) / 180);
  ctx.font = layout.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = layer.align;
  ctx.lineJoin = "round";
  const { pad } = layout;
  const half = layout.width / 2;
  const x = layer.align === "left" ? -half + pad : layer.align === "right" ? half - pad : 0;
  const top = -layout.height / 2 + pad;
  layout.lines.forEach((line, i) => {
    const y = top + layout.lineHeightPx * (i + 0.5);
    if (layout.strokePx > 0) {
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layout.strokePx * 2;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}
