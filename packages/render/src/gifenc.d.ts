declare module "gifenc" {
  export type Palette = number[][];
  export type PixelFormat = "rgb565" | "rgb444" | "rgba4444";
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: PixelFormat; oneBitAlpha?: boolean | number },
  ): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: PixelFormat): Uint8Array;
  export interface GifStream {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifStream;
}
