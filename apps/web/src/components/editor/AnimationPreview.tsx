import { useEffect, useRef, useState } from "react";
import { composeFrame, context2d, frameIndexAt, type DecodedMedia } from "@memegen/render";
import type { TextLayer } from "@memegen/shared";
import { Button, Icon } from "@memegen/ui";

/** Longest side of the preview, in CSS pixels. */
const PREVIEW_MAX = 240;

/** "Preview" toggle plus a small looping render of the meme, to check animation timings. */
export function AnimationPreview({ media, layers }: { media: DecodedMedia; layers: readonly TextLayer[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="animation-preview">
      <Button
        size="sm"
        icon={<Icon name={open ? "pause" : "play"} />}
        aria-pressed={open}
        data-testid="preview-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide preview" : "Preview"}
      </Button>
      {open && <PreviewLoop media={media} layers={layers} />}
    </div>
  );
}

/**
 * Plays the meme in real time with the export's compositor (`composeFrame`), each frame at its own start time and
 * duration and the layers evaluated at that frame's start, exactly like the GIF/MP4 export. Frames that decode too
 * slowly to keep up are skipped rather than slowing the clock. Edits show on the next frame drawn.
 * `data-frame` / `data-loop` on the canvas expose playback state to tests.
 */
function PreviewLoop({ media, layers }: { media: DecodedMedia; layers: readonly TextLayer[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const scale = Math.min(1, PREVIEW_MAX / Math.max(media.width, media.height));
  const cssWidth = Math.max(1, Math.round(media.width * scale));
  const cssHeight = Math.max(1, Math.round(media.height * scale));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
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
      composeFrame(ctx, image, layersRef.current, canvas.width, canvas.height, media.times[index]!);
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
  }, [media, cssWidth, cssHeight]);

  return <canvas ref={canvasRef} data-testid="animation-preview" style={{ width: cssWidth, height: cssHeight }} aria-label="Animation preview" />;
}
