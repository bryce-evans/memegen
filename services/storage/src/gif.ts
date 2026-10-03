import { gifFrameDelayMs } from "@memegen/shared";

export interface GifInfo {
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
}

/** Walks GIF blocks to count frames and sum delays without decoding pixels. */
export function readGifInfo(b: Uint8Array): GifInfo {
  const fail = (why: string): never => {
    throw new Error(`malformed GIF: ${why}`);
  };
  if (b.length < 13) fail("truncated header");
  const u16 = (o: number) => b[o]! | (b[o + 1]! << 8);
  const width = u16(6);
  const height = u16(8);
  let p = 13;
  const packed = b[10]!;
  if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1));

  const skipSubBlocks = () => {
    for (;;) {
      if (p >= b.length) fail("truncated sub-blocks");
      const size = b[p++]!;
      if (size === 0) return;
      p += size;
    }
  };

  let frameCount = 0;
  let durationMs = 0;
  let pendingDelay: number | null = null;
  while (p < b.length) {
    const block = b[p++]!;
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && b[p] === 4) {
        pendingDelay = u16(p + 2);
      }
      skipSubBlocks();
    } else if (block === 0x2c) {
      if (p + 9 > b.length) fail("truncated image descriptor");
      const local = b[p + 8]!;
      p += 9;
      if (local & 0x80) p += 3 * (1 << ((local & 0x07) + 1));
      p += 1; // LZW minimum code size
      skipSubBlocks();
      frameCount++;
      // Delays are in centiseconds; a frame without a graphic control extension plays like a 0 delay.
      durationMs += gifFrameDelayMs((pendingDelay ?? 0) * 10);
      pendingDelay = null;
    } else {
      fail(`unknown block 0x${block.toString(16)} at ${p - 1}`);
    }
  }
  if (frameCount === 0) fail("no frames");
  return { width, height, frameCount, durationMs };
}
