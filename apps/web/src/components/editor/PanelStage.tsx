import { useEffect, useRef, useState, type CSSProperties } from "react";
import { composePanels, panelSetGrid, type AssetImages, type PanelBox } from "@memegen/render";
import type { PanelSet } from "@memegen/shared";
import { Alert, cx, EmptyState } from "@memegen/ui";
import { useCanvasScale } from "./useCanvasScale.ts";

export interface PanelStageProps {
  set: PanelSet;
  images: AssetImages;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Show just the finished meme: no panel boxes or selection, no transparency checkerboard. */
  preview?: boolean;
}

/**
 * Multi-panel preview, drawn by the export's compositor at displayed size × device pixels. Panels can only be
 * selected (to edit their caption or image reference); pack images are never moved, cropped or resized.
 */
export function PanelStage({ set, images, selectedId, onSelect, preview = false }: PanelStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boxes, setBoxes] = useState<PanelBox[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const empty = set.panels.length === 0;
  const grid = empty ? null : panelSetGrid(set, images);
  const aspect = grid ? grid.width / grid.height : 1;
  const { pixelWidth, boxScale } = useCanvasScale(canvasRef, 800, !empty);
  const pixelHeight = Math.max(1, Math.round(pixelWidth / aspect));

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || empty) return;
    try {
      setBoxes(composePanels(ctx, set, images, pixelWidth, pixelHeight));
      setError(null);
      setReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [set, images, empty, pixelWidth, pixelHeight]);

  if (empty) {
    return (
      <div className="stage">
        <EmptyState data-testid="panel-empty" title="No panels yet" description="Add images to the pack; each one starts a panel." />
      </div>
    );
  }

  return (
    <div className="stage" data-testid="stage" data-preview={preview || undefined}>
      <div
        className="stage-inner"
        style={{ "--stage-aspect": aspect } as CSSProperties}
        onPointerDown={preview ? undefined : () => onSelect(null)}
      >
        <canvas
          ref={canvasRef}
          width={pixelWidth}
          height={pixelHeight}
          className="stage-canvas"
          data-testid="stage-canvas"
          data-ready={ready ? "true" : undefined}
        />
        {!preview && boxes.map((box, i) => (
          <div
            key={box.panelId}
            data-testid="panel-box"
            data-panel-id={box.panelId}
            className={cx("handle", "panel-handle", box.panelId === selectedId && "selected", box.overflow && "overflow")}
            title={box.overflow ? "Text does not fit the panel at the minimum size" : `Panel ${i + 1}`}
            style={{ left: box.x * boxScale, top: box.y * boxScale, width: box.width * boxScale, height: box.height * boxScale }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(box.panelId);
            }}
          />
        ))}
      </div>
      {error && (
        <Alert tone="danger" data-testid="editor-error">
          Could not draw panels: {error}
        </Alert>
      )}
    </div>
  );
}
