import { useEffect, useRef, useState, type PointerEvent } from "react";
import { canvasHeight, composeFrame, type DecodedMedia, type LayerBox, type LayerImages } from "@memegen/render";
import { layerArea, layerLabel, layerStateAt, type ImageLayer, type Layer } from "@memegen/shared";
import { Alert } from "@memegen/ui";

export interface StageProps {
  media: DecodedMedia;
  layers: Layer[];
  /** Decoded image-layer assets; a layer whose image is still loading draws nothing but stays selectable. */
  images: LayerImages;
  frame: number;
  selectedId: string | null;
  /** Bumped whenever a font finishes loading so text is re-measured. */
  fontsVersion: number;
  onSelect: (id: string | null) => void;
  /** Move a layer to (x, y) fractions at the current frame; the caller clamps. */
  onMove: (id: string, x: number, y: number) => void;
  /** Resize an image layer to `width` (fraction of the media width; the height follows the image); the caller clamps. */
  onResize: (id: string, width: number) => void;
  /** Rotate a layer to `angle` degrees clockwise; the caller normalizes. */
  onRotate: (id: string, angle: number) => void;
  /** A text layer's box was pressed: focus its text field so typing edits it. */
  onEditText: (id: string) => void;
}

/** A pointer gesture on a layer: move its anchor, or scale/rotate it around its center (client px). */
type Drag = { id: string; pointerId: number } & (
  | { kind: "move"; startX: number; startY: number; x0: number; y0: number }
  | { kind: "scale"; cx: number; cy: number; d0: number; width0: number }
  | { kind: "rotate"; cx: number; cy: number; a0: number; angle0: number }
);

const CORNERS = ["nw", "ne", "se", "sw"] as const;
/** Shift-rotate snaps to this many degrees. */
const ROTATE_SNAP = 15;

export function Stage({ media, layers, images, frame, selectedId, fontsVersion, onSelect, onMove, onResize, onRotate, onEditText }: StageProps) {
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
  // A top section adds its band (sized by its text) above the media.
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = displayWidth > 0 ? Math.round(displayWidth * dpr) : media.width;
  const mediaPixelHeight = Math.max(1, Math.round((pixelWidth * media.height) / media.width));
  const pixelHeight = canvasHeight(layers, pixelWidth, mediaPixelHeight);
  const aspect = media.width / canvasHeight(layers, media.width, media.height);
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
      setBoxes(composeFrame(ctx, image, layers, images, pixelWidth, pixelHeight, t));
      setError(null);
      setReady(true);
    };
    draw().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [media, frame, t, layers, images, fontsVersion, pixelWidth, pixelHeight]);

  function startDrag(e: PointerEvent<HTMLDivElement>, layer: Layer) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(layer.id);
    if (layer.type === "text") onEditText(layer.id);
    const state = layerStateAt(layer, t);
    drag.current = { kind: "move", id: layer.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x0: state.x, y0: state.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  /** Start scaling (corner handles; distance from the center sets the width) or rotating (the handle above the box). */
  function startTransform(e: PointerEvent<HTMLDivElement>, layer: ImageLayer, box: LayerBox, kind: "scale" | "rotate") {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + box.cx * boxScale;
    const cy = rect.top + box.cy * boxScale;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const base = { id: layer.id, pointerId: e.pointerId, cx, cy };
    drag.current =
      kind === "scale"
        ? { ...base, kind, d0: Math.max(1, Math.hypot(dx, dy)), width0: layer.width }
        : { ...base, kind, a0: Math.atan2(dy, dx), angle0: layer.angle };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const layer = d && layers.find((l) => l.id === d.id);
    if (!d || !layer || d.pointerId !== e.pointerId || displayWidth <= 0) return;
    if (d.kind === "scale") {
      onResize(d.id, (d.width0 * Math.hypot(e.clientX - d.cx, e.clientY - d.cy)) / d.d0);
      return;
    }
    if (d.kind === "rotate") {
      // Screen y points down, so atan2 grows clockwise, like the layer's angle.
      const angle = d.angle0 + ((Math.atan2(e.clientY - d.cy, e.clientX - d.cx) - d.a0) * 180) / Math.PI;
      onRotate(d.id, e.shiftKey ? Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP : Math.round(angle));
      return;
    }
    // Fractions of the layer's own area: the band for the top section's text, else the media.
    const area = layerArea(layer, pixelWidth, pixelHeight, pixelHeight - mediaPixelHeight);
    onMove(d.id, d.x0 + (e.clientX - d.startX) / (area.width * boxScale), d.y0 + (e.clientY - d.startY) / (area.height * boxScale));
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }

  return (
    <div className="stage">
      <div
        className="stage-inner"
        style={{ width: `min(100%, calc(68vh * ${aspect}))` }}
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
          const index = layers.findIndex((l) => l.id === box.layerId);
          const layer = layers[index];
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
              title={box.overflow ? "Text does not fit the box at the minimum size" : layer.type === "text" ? layer.text : layerLabel(layer, index)}
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
            >
              {layer.type === "image" && box.layerId === selectedId && (
                <>
                  {CORNERS.map((corner) => (
                    <div
                      key={corner}
                      className={`transform-handle scale ${corner}`}
                      data-testid="layer-scale-handle"
                      data-corner={corner}
                      title="Drag to resize"
                      onPointerDown={(e) => startTransform(e, layer, box, "scale")}
                    />
                  ))}
                  <div
                    className="transform-handle rotate"
                    data-testid="layer-rotate-handle"
                    title="Drag to rotate (Shift snaps to 15°)"
                    onPointerDown={(e) => startTransform(e, layer, box, "rotate")}
                  />
                </>
              )}
            </div>
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
