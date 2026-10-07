import { applyPalette, GIFEncoder, quantize } from "gifenc";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import type { Layer } from "@memegen/shared";
import { context2d, createCanvas, yieldToEventLoop } from "./canvas.ts";
import { composeFrame, drawLayers } from "./compose.ts";
import type { DecodedMedia } from "./decode.ts";
import type { LayerImages } from "./images.ts";

export interface ExportOptions {
  /** 0..1 */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  /** Output size for stills (default: the media's native size); GIFs and videos always keep their own. */
  stillSize?: { width: number; height: number };
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  extension: string;
}

export class ExportAbortedError extends Error {
  constructor() {
    super("export canceled");
  }
}

/**
 * Render layers onto the media and encode: still → PNG/JPEG, GIF → GIF, video → MP4 (audio kept). `images` holds the
 * image layers' decoded assets (`ensureLayerImages`).
 */
export async function exportMeme(
  media: DecodedMedia,
  layers: readonly Layer[],
  images: LayerImages,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  switch (media.kind) {
    case "image":
      return exportImage(media, layers, images, opts.stillSize ?? { width: media.width, height: media.height });
    case "gif":
      return exportGif(media, layers, images, opts);
    case "video":
      return exportVideo(media, layers, images, opts);
  }
}

async function exportImage(
  media: DecodedMedia,
  layers: readonly Layer[],
  images: LayerImages,
  size: { width: number; height: number },
): Promise<ExportResult> {
  const canvas = createCanvas(size.width, size.height);
  composeFrame(context2d(canvas), await media.frame(0), layers, images, canvas.width, canvas.height, 0);
  const jpeg = media.mime === "image/jpeg";
  const mime = jpeg ? "image/jpeg" : "image/png";
  const blob = await canvas.convertToBlob({ type: mime, quality: jpeg ? 0.92 : undefined });
  return { blob, mime, extension: jpeg ? ".jpg" : ".png" };
}

async function exportGif(media: DecodedMedia, layers: readonly Layer[], images: LayerImages, opts: ExportOptions): Promise<ExportResult> {
  const { width, height } = media;
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas, { willReadFrequently: true });
  const gif = GIFEncoder();
  const total = media.times.length;
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new ExportAbortedError();
    composeFrame(ctx, await media.frame(i), layers, images, width, height, media.times[i]!);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, {
      palette,
      delay: Math.round(media.durations[i]! * 1000),
      repeat: 0,
    });
    opts.onProgress?.((i + 1) / total);
    if (i % 5 === 4) await yieldToEventLoop();
  }
  gif.finish();
  return { blob: new Blob([gif.bytes() as BlobPart], { type: "image/gif" }), mime: "image/gif", extension: ".gif" };
}

async function exportVideo(media: DecodedMedia, layers: readonly Layer[], images: LayerImages, opts: ExportOptions): Promise<ExportResult> {
  const { width, height } = media;
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1", "hevc"], { width, height });
  if (!codec) throw new Error("this browser cannot encode MP4 video (no WebCodecs encoder available)");

  const input = new Input({ source: new BlobSource(media.source), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas);
  let firstTimestamp: number | null = null;

  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec,
        forceTranscode: true,
        process: (sample) => {
          firstTimestamp ??= sample.timestamp;
          ctx.clearRect(0, 0, width, height);
          sample.draw(ctx, 0, 0, width, height);
          drawLayers(ctx, layers, images, width, height, sample.timestamp - firstTimestamp);
          return canvas;
        },
        processedWidth: width,
        processedHeight: height,
      },
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(", ");
      throw new Error(`cannot convert this video (${reasons})`);
    }
    conversion.onProgress = (p) => opts.onProgress?.(p);
    const abort = () => void conversion.cancel();
    opts.signal?.addEventListener("abort", abort, { once: true });
    try {
      await conversion.execute();
    } finally {
      opts.signal?.removeEventListener("abort", abort);
    }
    if (opts.signal?.aborted) throw new ExportAbortedError();
  } finally {
    input.dispose();
  }
  if (!target.buffer) throw new Error("video encoder produced no output");
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), mime: "video/mp4", extension: ".mp4" };
}
