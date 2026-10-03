import { useEffect, useRef, useState, type PointerEvent } from "react";
import { composeFrame, layerBoxes, type DecodedMedia, type LayerBox } from "@memegen/render";
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
  /** Move a layer to (x, y) fractions at the current frame. */
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

/** Keep anchors near the media; the shared schema accepts -1..2. */
const clampAnchor = (v: number) => Math.min(1.5, Math.max(-0.5, v));

export function Stage({ media, layers, frame, selectedId, fontsVersion, onSelect, onMove }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCache = useRef<{ index: number; image: CanvasImageSource } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [boxes, setBoxes] = useState<LayerBox[]>([]);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const t = media.times[frame] ?? 0;
  const scale = displayWidth / media.width;

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
      composeFrame(ctx, image, layers, media.width, media.height, t);
      setBoxes(layerBoxes(ctx, layers, media.width, media.height, t));
      setError(null);
      setReady(true);
    };
    draw().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [media, frame, t, layers, fontsVersion]);

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
    if (!d || d.pointerId !== e.pointerId || scale <= 0) return;
    const x = clampAnchor(d.x0 + (e.clientX - d.startX) / scale / media.width);
    const y = clampAnchor(d.y0 + (e.clientY - d.startY) / scale / media.height);
    onMove(d.id, x, y);
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
          width={media.width}
          height={media.height}
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
                left: (box.cx - box.width / 2) * scale,
                top: (box.cy - box.height / 2) * scale,
                width: box.width * scale,
                height: box.height * scale,
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
        <Alert tone="error" data-testid="editor-error">
          Could not draw frame: {error}
        </Alert>
      )}
    </div>
  );
}
