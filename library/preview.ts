import {
  composeFrame,
  composedSize,
  decodeMedia,
  ensureLayerFonts,
  frameIndexAt,
  type AssetImages,
  type DecodedMedia,
} from "@memegen/render";
import { manifestLayers, type ManifestTemplate } from "./manifest.ts";

const fonts = {
  impact: "00000000-0000-4000-8000-000000000001",
  sans: "00000000-0000-4000-8000-000000000002",
  thin: "00000000-0000-4000-8000-000000000003",
  comic: "00000000-0000-4000-8000-000000000004",
};
const fontUrls: Record<string, string> = {
  [fonts.impact]: "/fonts/impact.ttf",
  [fonts.sans]: "/fonts/sans.ttf",
  [fonts.thin]: "/fonts/thin.ttf",
  [fonts.comic]: "/fonts/comic.ttf",
};
const images: AssetImages = new Map();

function waitForImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  image.loading = "eager";
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const finish = (error?: Error) => {
    image.removeEventListener("load", loaded);
    image.removeEventListener("error", failed);
    signal.removeEventListener("abort", aborted);
    if (error) reject(error);
    else resolve();
  };
  const loaded = () => finish();
  const failed = () => finish(new Error("The source image could not be loaded."));
  const aborted = () => finish(new DOMException("Preview cancelled", "AbortError"));
  image.addEventListener("load", loaded, { once: true });
  image.addEventListener("error", failed, { once: true });
  signal.addEventListener("abort", aborted, { once: true });
  if (signal.aborted) aborted();
  // A new checkbox attempt also retries an earlier failed image request.
  else if (image.complete) image.src = image.src;
  return promise;
}

/** Starts loading immediately and returns disposal without waiting for fonts or GIF decoding. */
export async function createCaptionPreview(
  entry: ManifestTemplate,
  image: HTMLImageElement,
  container: HTMLElement,
): Promise<() => void> {
  const controller = new AbortController();
  const { signal } = controller;
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "placeholder-canvas";
  canvas.dataset.ready = "false";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${entry.title} with placeholder text`);
  canvas.hidden = true;
  image.after(canvas);
  container.textContent = "Loading placeholder fonts and image…";
  let decoded: DecodedMedia | null = null;
  let animation: number | undefined;

  const release = () => {
    controller.abort();
    if (animation !== undefined) cancelAnimationFrame(animation);
    decoded?.dispose();
    decoded = null;
    canvas.hidden = true;
    canvas.dataset.ready = "false";
    canvas.width = 0;
    canvas.height = 0;
    image.hidden = image.complete && image.naturalWidth === 0;
  };
  const fail = (error: unknown) => {
    if (signal.aborted) return;
    release();
    const message = error instanceof Error ? error.message : String(error);
    container.textContent = `Placeholder preview unavailable: ${message} Uncheck and check the box to retry.`;
  };

  const start = async () => {
    let layers = manifestLayers(entry, fonts);
    try {
      await ensureLayerFonts(layers, (id) => fontUrls[id]!);
    } catch {
      throw new Error("Could not load the required fonts. Run library download to install the preview fonts.");
    }
    if (signal.aborted) return;
    await waitForImage(image, signal);
    if (signal.aborted) return;

    const animated = new URL(entry.url).pathname.toLowerCase().endsWith(".gif");
    if (animated) {
      container.textContent = "Loading animated image…";
      const response = await fetch(entry.url, { signal, referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`Could not load the animated image (HTTP ${response.status}).`);
      const blob = await response.blob();
      if (signal.aborted) return;
      const media = await decodeMedia(blob, "gif");
      if (signal.aborted) {
        media.dispose();
        return;
      }
      decoded = media;
      layers = manifestLayers(entry, fonts, media.duration);
    }
    // Stills draw directly from the image; no CORS fetch or canvas readback is needed.

    const media = decoded;
    const source = media ?? { width: image.naturalWidth, height: image.naturalHeight };
    const size = composedSize(layers, source, source.width);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot create a canvas preview.");
    const first = media ? await media.frame(0) : image;
    if (signal.aborted) return;
    composeFrame(context, first, layers, images, size.width, size.height, 0);
    canvas.dataset.ready = "true";
    canvas.hidden = false;
    image.hidden = true;
    container.textContent = "";
    if (!media || media.duration <= 0) return;

    const started = performance.now();
    let previous = 0;
    const tick = async (now: number) => {
      if (signal.aborted) return;
      const elapsed = (now - started) / 1000;
      const loop = Math.floor(elapsed / media.duration);
      const index = frameIndexAt(media.times, elapsed - loop * media.duration);
      if (index !== previous) {
        const frame = await media.frame(index);
        if (signal.aborted) return;
        composeFrame(context, frame, layers, images, size.width, size.height, media.times[index]!);
        previous = index;
      }
      animation = requestAnimationFrame((time) => void tick(time).catch(fail));
    };
    animation = requestAnimationFrame((time) => void tick(time).catch(fail));
  };
  void start().catch(fail);

  return () => {
    release();
    canvas.remove();
    container.textContent = "";
  };
}
