import { useEffect, useRef, useState } from "react";
import { composeFrame, context2d, frameIndexAt, type DecodedMedia, type LayerImages } from "@memegen/render";
import type { Layer } from "@memegen/shared";
import { Button, Icon, Panel } from "@memegen/ui";

interface PreviewProps {
  media: DecodedMedia;
  layers: readonly Layer[];
  /** Decoded image-layer assets (`ensureLayerImages`). */
  images: LayerImages;
}

/** The "Preview" card (GIF/video): a button that plays the finished meme on a loop, exactly as it will export. */
export function PreviewPanel({ media, layers, images }: PreviewProps) {
  const [open, setOpen] = useState(false);
  return (
    <Panel
      heading="Preview"
      className="preview-panel"
      headingActions={
        <Button
          size="sm"
          icon={<Icon name={open ? "pause" : "play"} />}
          aria-pressed={open}
          data-testid="preview-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide preview" : `Preview ${media.kind === "gif" ? "GIF" : "video"}`}
        </Button>
      }
    >
      {open && <PreviewLoop media={media} layers={layers} images={images} />}
    </Panel>
  );
}

/**
 * Plays the meme in real time with the export's compositor (`composeFrame`), each frame at its own start time and
 * duration and the layers evaluated at that frame's start, exactly like the GIF/MP4 export. Frames that decode too
 * slowly to keep up are skipped rather than slowing the clock. Edits show on the next frame drawn.
 * `data-frame` / `data-loop` on the canvas expose playback state to tests.
 */
function PreviewLoop({ media, layers, images }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layersRef = useRef({ layers, images });
  layersRef.current = { layers, images };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The canvas fills the card's width at the media's aspect ratio (CSS); render at that size × devicePixelRatio.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round((canvas.width * media.height) / media.width));
    const ctx = context2d(canvas);
    const start = performance.now();
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const elapsed = (performance.now() - start) / 1000;
      const loop = media.duration > 0 ? Math.floor(elapsed / media.duration) : 0;
      const index = frameIndexAt(media.times, elapsed - loop * media.duration);
      const image = await media.frame(index);
      if (cancelled) return;
      composeFrame(ctx, image, layersRef.current.layers, layersRef.current.images, canvas.width, canvas.height, media.times[index]!);
      canvas.dataset.frame = String(index);
      canvas.dataset.loop = String(loop);
      if (media.duration <= 0) return;
      const next = loop * media.duration + media.times[index]! + media.durations[index]!;
      timer = window.setTimeout(() => void tick(), Math.max(0, (next - (performance.now() - start) / 1000) * 1000));
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [media]);

  return (
    <canvas
      ref={canvasRef}
      className="preview-canvas"
      data-testid="animation-preview"
      style={{ aspectRatio: `${media.width} / ${media.height}` }}
      aria-label="Meme preview"
    />
  );
}
