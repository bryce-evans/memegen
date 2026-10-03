import { imageSize } from "image-size";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import type { AssetKind, MediaFacts } from "@memegen/shared";
import { readGifInfo } from "./gif.ts";

export interface MediaInfo extends MediaFacts {
  durationMs: number | null;
  fps: number | null;
}

export class ProbeError extends Error {}

/**
 * Extract dimensions/timing without decoding frames; null for fonts, which have neither.
 * Throws ProbeError for unreadable media.
 */
export async function probe(kind: AssetKind, data: Uint8Array): Promise<MediaInfo | null> {
  try {
    switch (kind) {
      case "font":
        return null;
      case "image": {
        const { width, height } = imageSize(data);
        return { kind, width, height, frameCount: 1, durationMs: null, fps: null };
      }
      case "gif": {
        const info = readGifInfo(data);
        return {
          kind,
          ...info,
          fps: info.durationMs > 0 ? Math.round((info.frameCount / info.durationMs) * 1000 * 100) / 100 : null,
        };
      }
      case "video":
        return await probeVideo(data);
    }
  } catch (err) {
    if (err instanceof ProbeError) throw err;
    throw new ProbeError(`could not read ${kind}: ${(err as Error).message}`);
  }
}

async function probeVideo(data: Uint8Array): Promise<MediaInfo> {
  using input = new Input({ source: new BufferSource(data), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new ProbeError("video has no video track");
  const stats = await track.computePacketStats();
  const duration = await input.computeDuration();
  return {
    kind: "video",
    width: track.displayWidth,
    height: track.displayHeight,
    durationMs: Math.round(duration * 1000),
    frameCount: stats.packetCount,
    fps: Math.round(stats.averagePacketRate * 100) / 100,
  };
}
