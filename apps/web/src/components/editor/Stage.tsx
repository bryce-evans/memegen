import { useEffect, useRef, useState, type PointerEvent } from "react";
import { composeFrame, type DecodedMedia, type LayerBox } from "@memegen/render";
import { layerStateAt, type TextLayer } from "@memegen/shared";
import { Alert } from "@memegen/ui";

export interface StageProps {
  media: DecodedMedia;
  layers: TextLayer[];
  frame: number;
  selectedId: string | null;
  /** Bumped whenever a font finishes loading so text is re-measured. */
  fontsVersion: number;
  onSelect: (id: string | null) => void;
  /** Move a layer to (x, y) fractions at the current frame; the caller clamps. */
  onMove: (id: string, x: number, y: number) => void;
}

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x0: number;
  y0: number;
}

export function Stage({ media, layers, frame, selectedId, fontsVersion, onSelect, onMove }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCache = useRef<{ index: number; image: CanvasImageSource } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [boxes, setBoxes] = useState<LayerBox[]>([]);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const t = media.times[frame] ?? 0;
  // Backing store at displayed size × device pixels, so text is rasterized at screen resolution instead of at the
  // media's (often small) native size and then stretched. Layout is in fractions, so the result matches the export.
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = displayWidth > 0 ? Math.round(displayWidth * dpr) : media.width;
  const pixelHeight = Math.max(1, Math.round((pixelWidth * media.height) / media.width));
  /** CSS px per canvas px, for placing the selection handles. */
  const boxScale = displayWidth > 0 ? displayWidth / pixelWidth : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setDisplayWidth(canvas.clientWidth));
    observer.observe(canvas);
    setDisplayWidth(canvas.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    frameCache.current = null;
  }, [media]);

  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const cached = frameCache.current;
      // Layer edits redraw constantly (dragging); only decode when the frame changes.
      const image = cached?.index === frame ? cached.image : await media.frame(frame);
      if (cancelled) return;
      frameCache.current = { index: frame, image };
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      setBoxes(composeFrame(ctx, image, layers, pixelWidth, pixelHeight, t));
      setError(null);
      setReady(true);
    };
    draw().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [media, frame, t, layers, fontsVersion, pixelWidth, pixelHeight]);

  function startDrag(e: PointerEvent<HTMLDivElement>, layer: TextLayer) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(layer.id);
    const state = layerStateAt(layer, t);
    drag.current = { id: layer.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x0: state.x, y0: state.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || displayWidth <= 0) return;
    const displayHeight = (displayWidth * media.height) / media.width;
    onMove(d.id, d.x0 + (e.clientX - d.startX) / displayWidth, d.y0 + (e.clientY - d.startY) / displayHeight);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }

  return (
    <div className="stage">
      <div
        className="stage-inner"
        style={{ width: `min(100%, calc(68vh * ${media.width / media.height}))` }}
        onPointerDown={() => onSelect(null)}
      >
        <canvas
          ref={canvasRef}
          width={pixelWidth}
          height={pixelHeight}
          className="stage-canvas"
          data-testid="stage-canvas"
          data-ready={ready ? "true" : undefined}
        />
        {boxes.map((box) => {
          const layer = layers.find((l) => l.id === box.layerId);
          if (!layer) return null;
          return (
            <div
              key={box.layerId}
              data-testid="layer-box"
              data-layer-id={box.layerId}
              className={[
                "handle",
                box.layerId === selectedId ? "selected" : "",
                box.overflow ? "overflow" : "",
              ].join(" ")}
              title={box.overflow ? "Text does not fit the box at the minimum size" : layer.text}
              style={{
                left: (box.cx - box.width / 2) * boxScale,
                top: (box.cy - box.height / 2) * boxScale,
                width: box.width * boxScale,
                height: box.height * boxScale,
                transform: `rotate(${box.angle}deg)`,
              }}
              onPointerDown={(e) => startDrag(e, layer)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          );
        })}
      </div>
      {error && (
        <Alert tone="danger" data-testid="editor-error">
          Could not draw frame: {error}
        </Alert>
      )}
    </div>
  );
}
