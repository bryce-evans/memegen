import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { composedSize, composeFrame, type AssetImages, type DecodedMedia, type LayerBox } from "@memegen/render";
import { layerArea, layerLabels, layerStateAt, resizeImage, resizeTextBox, type ImageLayer, type Layer, type TextLayer } from "@memegen/shared";
import { Alert, cx } from "@memegen/ui";
import { useCanvasScale } from "./useCanvasScale.ts";

export interface StageProps {
  media: DecodedMedia;
  layers: Layer[];
  /** Decoded image-layer assets; a layer whose image is still loading draws nothing but stays selectable. */
  images: AssetImages;
  frame: number;
  selectedId: string | null;
  /** Bumped whenever a font finishes loading so text is re-measured. */
  fontsVersion: number;
  onSelect: (id: string | null) => void;
  /** Move a layer to (x, y) fractions at the current frame; the caller clamps. */
  onMove: (id: string, x: number, y: number) => void;
  /**
   * Resize an image layer to `width` (fraction of the media width; the height follows the image) with its center at
   * (x, y) fractions, so the corner opposite the dragged one stays put; the caller clamps.
   */
  onResize: (id: string, width: number, x: number, y: number) => void;
  /**
   * Resize a text layer's box to `maxWidth`×`maxHeight` (fractions of the media) with its center at (x, y) fractions,
   * so the corner opposite the dragged one stays put; the caller clamps the position.
   */
  onResizeText: (id: string, maxWidth: number, maxHeight: number, x: number, y: number) => void;
  /** Rotate a layer to `angle` degrees clockwise; the caller normalizes. */
  onRotate: (id: string, angle: number) => void;
  /** A text layer's box was pressed: focus its text field so typing edits it. */
  onEditText: (id: string) => void;
}

/**
 * A pointer gesture on a layer: move its anchor (client px); scale it about the corner opposite the dragged handle
 * (canvas px: `ox,oy` that fixed corner, `dx,dy` the diagonal from it to the dragged corner at the start, `p0` the
 * start pointer's projection on that diagonal); resize a text box about the corner opposite the dragged one (canvas
 * px: `ox,oy` that fixed corner, `sx,sy` the dragged corner's side in the box's own frame); or rotate it around its
 * center (client px).
 */
type Drag = { id: string; pointerId: number } & (
  | { kind: "move"; startX: number; startY: number; x0: number; y0: number }
  | { kind: "scale"; ox: number; oy: number; dx: number; dy: number; p0: number; width0: number }
  | { kind: "box"; ox: number; oy: number; sx: number; sy: number; angle: number }
  | { kind: "rotate"; cx: number; cy: number; a0: number; angle0: number }
);

type Corner = "nw" | "ne" | "se" | "sw";
const CORNERS: readonly Corner[] = ["nw", "ne", "se", "sw"];
/** Shift-rotate snaps to this many degrees. */
const ROTATE_SNAP = 15;

export function Stage({ media, layers, images, frame, selectedId, fontsVersion, onSelect, onMove, onResize, onResizeText, onRotate, onEditText }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCache = useRef<{ index: number; image: CanvasImageSource } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [boxes, setBoxes] = useState<LayerBox[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const t = media.times[frame] ?? 0;
  // Drawn at displayed size × device pixels; layout is in fractions, so the result matches the export. A top section
  // adds its band (sized by its text) above the media.
  const { displayWidth, pixelWidth, boxScale } = useCanvasScale(canvasRef, media.width);
  const { height: pixelHeight, mediaHeight: mediaPixelHeight } = composedSize(layers, media, pixelWidth);
  const native = composedSize(layers, media, media.width);
  const aspect = native.width / native.height;

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

  /** Pointer position in canvas px. */
  function canvasPoint(e: PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || boxScale <= 0) return null;
    return { x: (e.clientX - rect.left) / boxScale, y: (e.clientY - rect.top) / boxScale };
  }

  /** Start scaling from a corner handle; the opposite corner stays fixed and the aspect ratio is kept. */
  function startScale(e: PointerEvent<HTMLDivElement>, layer: ImageLayer, box: LayerBox, corner: Corner) {
    e.stopPropagation();
    e.preventDefault();
    const p = canvasPoint(e);
    if (!p) return;
    // The dragged corner's offset from the center in the layer's own frame, then rotated onto the canvas (clockwise).
    const hx = ((corner === "ne" || corner === "se" ? 1 : -1) * box.width) / 2;
    const hy = ((corner === "se" || corner === "sw" ? 1 : -1) * box.height) / 2;
    const rad = (box.angle * Math.PI) / 180;
    const rx = hx * Math.cos(rad) - hy * Math.sin(rad);
    const ry = hx * Math.sin(rad) + hy * Math.cos(rad);
    const ox = box.cx - rx;
    const oy = box.cy - ry;
    const dx = 2 * rx;
    const dy = 2 * ry;
    const p0 = Math.max(1, (p.x - ox) * dx + (p.y - oy) * dy);
    drag.current = { kind: "scale", id: layer.id, pointerId: e.pointerId, ox, oy, dx, dy, p0, width0: layer.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  /** Start resizing a text box from a corner handle; the opposite corner stays fixed, width and height change freely. */
  function startBox(e: PointerEvent<HTMLDivElement>, layer: TextLayer, box: LayerBox, frameW: number, frameH: number, corner: Corner) {
    e.stopPropagation();
    e.preventDefault();
    const sx = corner === "ne" || corner === "se" ? 1 : -1;
    const sy = corner === "se" || corner === "sw" ? 1 : -1;
    const rad = (box.angle * Math.PI) / 180;
    // The fixed corner: the dragged one mirrored through the center, rotated onto the canvas (clockwise).
    const hx = (-sx * frameW) / 2;
    const hy = (-sy * frameH) / 2;
    const ox = box.cx + hx * Math.cos(rad) - hy * Math.sin(rad);
    const oy = box.cy + hx * Math.sin(rad) + hy * Math.cos(rad);
    drag.current = { kind: "box", id: layer.id, pointerId: e.pointerId, ox, oy, sx, sy, angle: rad };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  /** Start rotating (the handle above the box) around the layer's center. */
  function startRotate(e: PointerEvent<HTMLDivElement>, layer: ImageLayer, box: LayerBox) {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + box.cx * boxScale;
    const cy = rect.top + box.cy * boxScale;
    drag.current = {
      kind: "rotate",
      id: layer.id,
      pointerId: e.pointerId,
      cx,
      cy,
      a0: Math.atan2(e.clientY - cy, e.clientX - cx),
      angle0: layer.angle,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const layer = d && layers.find((l) => l.id === d.id);
    if (!d || !layer || d.pointerId !== e.pointerId || displayWidth <= 0) return;
    // Fractions of the layer's own area: the band for the top section's text, else the media.
    const area = layerArea(layer, pixelWidth, pixelHeight, pixelHeight - mediaPixelHeight);
    if (d.kind === "scale") {
      const p = canvasPoint(e);
      if (!p || layer.type !== "image") return;
      // Scale by the pointer's progress along the diagonal, clamped like the width; the center slides along the
      // diagonal so the fixed corner keeps its place.
      const along = ((p.x - d.ox) * d.dx + (p.y - d.oy) * d.dy) / d.p0;
      const width = resizeImage(layer, d.width0 * along).width;
      const k = width / d.width0;
      const cx = d.ox + (k * d.dx) / 2;
      const cy = d.oy + (k * d.dy) / 2;
      onResize(d.id, width, cx / area.width, (cy - area.top) / area.height);
      return;
    }
    if (d.kind === "box") {
      const p = canvasPoint(e);
      if (!p || layer.type !== "text") return;
      // The pointer relative to the fixed corner, in the box's own (unrotated) frame, gives the new size.
      const cos = Math.cos(d.angle);
      const sin = Math.sin(d.angle);
      const vx = p.x - d.ox;
      const vy = p.y - d.oy;
      const sized = resizeTextBox(layer, (d.sx * (vx * cos + vy * sin)) / area.width, (d.sy * (-vx * sin + vy * cos)) / area.height);
      // The center sits half the (clamped) size from the fixed corner.
      const hx = (d.sx * sized.maxWidth * area.width) / 2;
      const hy = (d.sy * sized.maxHeight * area.height) / 2;
      const cx = d.ox + hx * cos - hy * sin;
      const cy = d.oy + hx * sin + hy * cos;
      onResizeText(d.id, sized.maxWidth, sized.maxHeight, cx / area.width, (cy - area.top) / area.height);
      return;
    }
    if (d.kind === "rotate") {
      // Screen y points down, so atan2 grows clockwise, like the layer's angle.
      const angle = d.angle0 + ((Math.atan2(e.clientY - d.cy, e.clientX - d.cx) - d.a0) * 180) / Math.PI;
      onRotate(d.id, e.shiftKey ? Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP : Math.round(angle));
      return;
    }
    onMove(d.id, d.x0 + (e.clientX - d.startX) / (area.width * boxScale), d.y0 + (e.clientY - d.startY) / (area.height * boxScale));
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }

  const labels = layerLabels(layers);
  return (
    <div className="stage">
      <div className="stage-inner" style={{ "--stage-aspect": aspect } as CSSProperties} onPointerDown={() => onSelect(null)}>
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
              className={cx("handle", box.layerId === selectedId && "selected", box.overflow && "overflow")}
              title={box.overflow ? "Text does not fit the box at the minimum size" : layer.type === "text" ? layer.text : labels[index]}
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
                      className={cx("transform-handle", "scale", corner)}
                      data-testid="layer-scale-handle"
                      data-corner={corner}
                      title="Drag to resize"
                      onPointerDown={(e) => startScale(e, layer, box, corner)}
                    />
                  ))}
                  <div
                    className="transform-handle rotate"
                    data-testid="layer-rotate-handle"
                    title="Drag to rotate (Shift snaps to 15°)"
                    onPointerDown={(e) => startRotate(e, layer, box)}
                  />
                </>
              )}
            </div>
          );
        })}
        {boxes.map((box) => {
          // The selected text layer's box (its text shrinks to fit it), with corner handles to resize it. The top
          // section's text fills its band, so it has no box to resize.
          const layer = layers.find((l) => l.id === box.layerId);
          if (box.layerId !== selectedId || layer?.type !== "text" || layer.topSection) return null;
          const area = layerArea(layer, pixelWidth, pixelHeight, pixelHeight - mediaPixelHeight);
          const frameW = layer.maxWidth * area.width;
          const frameH = layer.maxHeight * area.height;
          return (
            <div
              key={`${box.layerId}-frame`}
              className="text-box-frame"
              data-testid="text-box-frame"
              style={{
                left: (box.cx - frameW / 2) * boxScale,
                top: (box.cy - frameH / 2) * boxScale,
                width: frameW * boxScale,
                height: frameH * boxScale,
                transform: `rotate(${box.angle}deg)`,
              }}
            >
              {CORNERS.map((corner) => (
                <div
                  key={corner}
                  className={cx("transform-handle", "scale", corner)}
                  data-testid="text-box-handle"
                  data-corner={corner}
                  title="Drag to resize the text box"
                  onPointerDown={(e) => startBox(e, layer, box, frameW, frameH, corner)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              ))}
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
