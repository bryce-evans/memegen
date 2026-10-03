import { decompressFrames, parseGIF } from "gifuct-js";
import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input, type InputVideoTrack } from "mediabunny";
import { gifFrameDelayMs, type MediaKind } from "@memegen/shared";
import { context2d, createCanvas, yieldToEventLoop } from "./canvas.ts";

/**
 * A decoded source the editor can scrub and the exporter can iterate.
 * Times are seconds, normalized so frame 0 starts at 0.
 */
export interface DecodedMedia {
  readonly kind: MediaKind;
  readonly source: Blob;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  /** Start time of every frame, ascending. */
  readonly times: readonly number[];
  /** Display duration of every frame. */
  readonly durations: readonly number[];
  readonly duration: number;
  /** Full-resolution frame. Callers must not mutate it. */
  frame(index: number): Promise<CanvasImageSource>;
  /** Small previews for every frame, in order, for the timeline. */
  thumbnails(height: number, onThumb: (index: number, image: CanvasImageSource) => void, signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

export function frameIndexAt(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export async function decodeMedia(source: Blob, kind: MediaKind): Promise<DecodedMedia> {
  switch (kind) {
    case "image":
      return decodeImage(source);
    case "gif":
      return decodeGif(source);
    case "video":
      return decodeVideo(source);
  }
}

function scaledThumb(image: CanvasImageSource, w: number, h: number, height: number): OffscreenCanvas {
  const canvas = createCanvas((w / h) * height, height);
  context2d(canvas).drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function decodeImage(source: Blob): Promise<DecodedMedia> {
  const bitmap = await createImageBitmap(source);
  return {
    kind: "image",
    source,
    mime: source.type,
    width: bitmap.width,
    height: bitmap.height,
    times: [0],
    durations: [0],
    duration: 0,
    frame: async () => bitmap,
    thumbnails: async (height, onThumb) => onThumb(0, scaledThumb(bitmap, bitmap.width, bitmap.height, height)),
    dispose: () => bitmap.close(),
  };
}

async function decodeGif(source: Blob): Promise<DecodedMedia> {
  const parsed = parseGIF(await source.arrayBuffer());
  const raw = decompressFrames(parsed, true);
  if (raw.length === 0) throw new Error("GIF has no frames");
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas, { willReadFrequently: true });
  const patchCanvas = createCanvas(1, 1);
  const patchCtx = context2d(patchCanvas);

  const frames: ImageBitmap[] = [];
  const times: number[] = [];
  const durations: number[] = [];
  let t = 0;
  let restore: ImageData | null = null;
  let previous: (typeof raw)[number] | null = null;
  for (const f of raw) {
    // Apply the previous frame's disposal before drawing this one.
    if (previous?.disposalType === 2) {
      const d = previous.dims;
      ctx.clearRect(d.left, d.top, d.width, d.height);
    } else if (previous?.disposalType === 3 && restore) {
      ctx.putImageData(restore, 0, 0);
    }
    restore = f.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;

    const { dims } = f;
    if (patchCanvas.width !== dims.width || patchCanvas.height !== dims.height) {
      patchCanvas.width = dims.width;
      patchCanvas.height = dims.height;
    }
    patchCtx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), dims.width, dims.height), 0, 0);
    ctx.drawImage(patchCanvas, dims.left, dims.top);

    frames.push(await createImageBitmap(canvas));
    const duration = gifFrameDelayMs(f.delay) / 1000;
    times.push(t);
    durations.push(duration);
    t += duration;
    previous = f;
  }

  return {
    kind: "gif",
    source,
    mime: "image/gif",
    width,
    height,
    times,
    durations,
    duration: t,
    frame: async (i) => frames[Math.min(Math.max(0, Math.round(i)), frames.length - 1)]!,
    thumbnails: async (h, onThumb, signal) => {
      for (let i = 0; i < frames.length; i++) {
        if (signal?.aborted) return;
        onThumb(i, scaledThumb(frames[i]!, width, height, h));
        if (i % 20 === 19) await yieldToEventLoop();
      }
    },
    dispose: () => frames.forEach((f) => f.close()),
  };
}

async function decodeVideo(source: Blob): Promise<DecodedMedia> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("video has no video track");
  if (!(await track.canDecode())) throw new Error(`this browser cannot decode ${track.codec ?? "this"} video`);

  const starts = await packetTimestamps(track);
  const first = starts[0] ?? 0;
  const times = starts.map((s) => s - first);
  const end = await track.computeDuration();
  const durations = times.map((s, i) => (times[i + 1] ?? end - first) - s);
  const sink = new CanvasSink(track, { poolSize: 0 });

  return {
    kind: "video",
    source,
    mime: source.type || "video/mp4",
    width: track.displayWidth,
    height: track.displayHeight,
    times,
    durations,
    duration: end - first,
    frame: async (i) => {
      const wrapped = await sink.getCanvas(times[Math.min(Math.max(0, Math.round(i)), times.length - 1)]! + first);
      if (!wrapped) throw new Error(`no video frame at index ${i}`);
      return wrapped.canvas;
    },
    thumbnails: async (height, onThumb, signal) => {
      const thumbSink = new CanvasSink(track, {
        height,
        width: Math.max(1, Math.round((track.displayWidth / track.displayHeight) * height)),
        fit: "fill",
        poolSize: 0,
      });
      let i = 0;
      for await (const wrapped of thumbSink.canvases()) {
        if (signal?.aborted) return;
        onThumb(Math.min(i++, times.length - 1), wrapped.canvas);
      }
    },
    dispose: () => input.dispose(),
  };
}

/** Presentation timestamps of every video packet (= frame), without decoding. */
async function packetTimestamps(track: InputVideoTrack): Promise<number[]> {
  const sink = new EncodedPacketSink(track);
  const out: number[] = [];
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    out.push(packet.timestamp);
  }
  return out.sort((a, b) => a - b);
}
