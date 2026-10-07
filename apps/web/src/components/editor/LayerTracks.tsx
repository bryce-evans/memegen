import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { DecodedMedia } from "@memegen/render";
import { layerLabel, type TextLayer, type WindowEdge } from "@memegen/shared";
import { cx } from "@memegen/ui";
import { clampEdgeFrame, setEdgeFrame, windowFrames } from "./windowFrames.ts";

export interface LayerTracksProps {
  media: DecodedMedia;
  layers: readonly TextLayer[];
  frame: number;
  selectedId: string | null;
  /** Width of one frame cell in the strip above, borders included. */
  cellWidth: number;
  /** Distance from one frame cell to the next (cell width plus the strip's gap). */
  pitch: number;
  onSelect: (id: string) => void;
  onUpdate: (id: string, update: (layer: TextLayer) => TextLayer) => void;
  onSeek: (frame: number) => void;
}

interface Drag {
  pointerId: number;
  edge: WindowEdge;
  index: number;
}

/**
 * One track per layer inside the timeline's scroller, laid out on the frame strip's own cells: a bar from the first
 * to the last frame the layer shows on, labelled with its text, with a handle at each end. Handles lock to frame
 * cells: the start to a cell's left edge, the end to a cell's right edge (an end of `times[k]` keeps frame k shown,
 * matching `isVisibleAt`). The first/last frame stores null ("from the start" / "until the end").
 */
export function LayerTracks({ media, layers, frame, selectedId, cellWidth, pitch, onSelect, onUpdate, onSeek }: LayerTracksProps) {
  const { times } = media;
  const last = times.length - 1;
  const drag = useRef<Drag | null>(null);

  /** Move one edge to frame `index` (clamped so the window can't invert), then show that frame. */
  function setEdge(layer: TextLayer, edge: WindowEdge, index: number): number {
    const i = clampEdgeFrame(layer, edge, index, times);
    onUpdate(layer.id, (l) => setEdgeFrame(l, edge, i, times));
    onSeek(i);
    return i;
  }

  function startDrag(e: PointerEvent<HTMLDivElement>, layer: TextLayer, edge: WindowEdge) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(layer.id);
    drag.current = { pointerId: e.pointerId, edge, index: windowFrames(layer, times)[edge] };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
  }

  function moveDrag(e: PointerEvent<HTMLDivElement>, layer: TextLayer) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // Measured on every move: seeking scrolls the strip to keep the current frame in view, which moves the rail.
    const x = e.clientX - e.currentTarget.parentElement!.getBoundingClientRect().left;
    const index = Math.round((d.edge === "start" ? x : x - cellWidth) / pitch);
    if (index !== d.index) d.index = setEdge(layer, d.edge, index);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }

  function nudge(e: KeyboardEvent<HTMLDivElement>, layer: TextLayer, edge: WindowEdge) {
    const current = windowFrames(layer, times)[edge];
    const next = { ArrowLeft: current - 1, ArrowDown: current - 1, ArrowRight: current + 1, ArrowUp: current + 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onSelect(layer.id);
    setEdge(layer, edge, next);
  }

  return (
    <div className="layer-tracks" data-testid="layer-tracks">
      {layers.map((layer, n) => {
        const label = layerLabel(layer, n);
        const { start: s, end: e } = windowFrames(layer, times);
        const left = s * pitch;
        const right = e * pitch + cellWidth;
        const handle = (edge: WindowEdge, at: number, index: number) => (
          <div
            role="slider"
            tabIndex={0}
            className={cx("layer-track-handle", edge)}
            style={{ left: at }}
            data-testid={`track-${edge}`}
            aria-label={`${label} ${edge}`}
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={index}
            aria-valuetext={`frame ${index + 1}`}
            onPointerDown={(ev) => startDrag(ev, layer, edge)}
            onPointerMove={(ev) => moveDrag(ev, layer)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(ev) => nudge(ev, layer, edge)}
          />
        );
        return (
          <div
            key={layer.id}
            className={cx("layer-track", layer.id === selectedId && "selected")}
            data-testid="layer-track"
            data-layer-id={layer.id}
            style={{ width: times.length * pitch - (pitch - cellWidth) }}
          >
            <div className="layer-track-span" data-testid="track-span" style={{ left, width: right - left }} onPointerDown={() => onSelect(layer.id)}>
              {layer.text.split("\n")[0]?.trim() || label}
            </div>
            <div className="layer-track-playhead" style={{ left: frame * pitch + cellWidth / 2 }} />
            {handle("start", left, s)}
            {handle("end", right, e)}
          </div>
        );
      })}
    </div>
  );
}
