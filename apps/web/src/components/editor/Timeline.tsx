import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { frameIndexAt, type DecodedMedia } from "@memegen/render";
import { isVisibleAt, type Layer } from "@memegen/shared";
import { Icon, IconButton, Panel, Text } from "@memegen/ui";
import { LayerTracks } from "./LayerTracks.tsx";

const THUMB_HEIGHT = 48;
/** Frame cell geometry, shared with `LayerTracks` (and exported to CSS) so the tracks line up with the cells. */
const THUMB_BORDER = 2;
const FRAME_GAP = 2;

export interface TimelineProps {
  media: DecodedMedia;
  frame: number;
  playing: boolean;
  selectedLayer: Layer | null;
  /** Every layer, each drawn as a window track under the frames, on the same cells. */
  layers: readonly Layer[];
  onSeek: (frame: number) => void;
  onTogglePlay: () => void;
  onSelectLayer: (id: string) => void;
  onUpdateLayer: (id: string, update: (layer: Layer) => Layer) => void;
}

export function Timeline({ media, frame, playing, selectedLayer, layers, onSeek, onTogglePlay, onSelectLayer, onUpdateLayer }: TimelineProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const count = media.times.length;
  const thumbWidth = Math.max(1, Math.round((media.width / media.height) * THUMB_HEIGHT));
  const cellWidth = thumbWidth + 2 * THUMB_BORDER;
  const [complete, setComplete] = useState(false);

  // Thumbnails stream in progressively; draw each into its slot as it arrives.
  useEffect(() => {
    const ac = new AbortController();
    setComplete(false);
    media
      .thumbnails(
        THUMB_HEIGHT,
        (index, image) => {
          const canvas = canvases.current[index];
          canvas?.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        },
        ac.signal,
      )
      .then(() => !ac.signal.aborted && setComplete(true))
      .catch((err: unknown) => console.warn("thumbnail generation failed:", err instanceof Error ? err.message : err));
    return () => ac.abort();
  }, [media]);

  // Keep the current frame visible without scrolling the page.
  useEffect(() => {
    const strip = stripRef.current;
    const cell = canvases.current[frame]?.parentElement;
    if (!strip || !cell) return;
    const left = cell.offsetLeft;
    const right = left + cell.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left - 8;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 8;
  }, [frame]);

  const keyframeFrames = useMemo(
    () => new Set(selectedLayer?.keyframes.map((k) => frameIndexAt(media.times, k.t)) ?? []),
    [selectedLayer, media.times],
  );

  const t = media.times[frame] ?? 0;

  return (
    <Panel variant="flush" className="timeline">
      <div className="transport">
        <IconButton size="sm" variant="quiet" data-testid="prev-frame" onClick={() => onSeek((frame - 1 + count) % count)} label="Previous frame">
          <Icon name="prev" />
        </IconButton>
        <IconButton size="sm" variant="primary" data-testid="play-toggle" onClick={onTogglePlay} label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} />
        </IconButton>
        <IconButton size="sm" variant="quiet" data-testid="next-frame" onClick={() => onSeek((frame + 1) % count)} label="Next frame">
          <Icon name="next" />
        </IconButton>
        <Text as="span" size="sm" numeric>
          {t.toFixed(2)}s / {media.duration.toFixed(2)}s · frame <span data-testid="current-frame">{frame + 1} / {count}</span>
        </Text>
        {selectedLayer && (selectedLayer.start !== null || selectedLayer.end !== null) && (
          <Text as="span" size="sm" tone="muted" numeric>
            layer shown {selectedLayer.start === null ? "start" : `${selectedLayer.start.toFixed(2)}s`} →{" "}
            {selectedLayer.end === null ? "end" : `${selectedLayer.end.toFixed(2)}s`}
          </Text>
        )}
      </div>
      {/* One scroller for the frames and the layer tracks, so a track's ends stay on the frames they mark. */}
      <div
        className="strip"
        ref={stripRef}
        data-testid="timeline"
        data-complete={complete ? "true" : undefined}
        style={{ "--frame-gap": `${FRAME_GAP}px`, "--thumb-border": `${THUMB_BORDER}px` } as CSSProperties}
      >
        <div className="strip-frames">
          {media.times.map((time, i) => (
            <Thumb
              key={i}
              index={i}
              time={time}
              width={thumbWidth}
              height={THUMB_HEIGHT}
              current={i === frame}
              keyframe={keyframeFrames.has(i)}
              outside={selectedLayer !== null && !isVisibleAt(selectedLayer, time)}
              onSeek={onSeek}
              canvases={canvases}
            />
          ))}
        </div>
        {layers.length > 0 && (
          <LayerTracks
            media={media}
            layers={layers}
            frame={frame}
            selectedId={selectedLayer?.id ?? null}
            cellWidth={cellWidth}
            pitch={cellWidth + FRAME_GAP}
            onSelect={onSelectLayer}
            onUpdate={onUpdateLayer}
            onSeek={onSeek}
          />
        )}
      </div>
    </Panel>
  );
}

interface ThumbProps {
  index: number;
  time: number;
  width: number;
  height: number;
  current: boolean;
  keyframe: boolean;
  outside: boolean;
  onSeek: (frame: number) => void;
  canvases: { current: (HTMLCanvasElement | null)[] };
}

/** Memoized so playback only re-renders the two cells whose `current` flag flips. */
const Thumb = memo(function Thumb({ index, time, width, height, current, keyframe, outside, onSeek, canvases }: ThumbProps) {
  const className = ["thumb", current ? "current" : "", keyframe ? "keyframe" : "", outside ? "outside" : ""].join(" ");
  return (
    <button
      type="button"
      className={className}
      data-testid="timeline-frame"
      data-index={index}
      onClick={() => onSeek(index)}
      title={`#${index + 1} · ${time.toFixed(2)}s`}
    >
      <canvas
        width={width}
        height={height}
        ref={(el) => {
          canvases.current[index] = el;
        }}
      />
      {keyframe && <span className="kf-mark" aria-label="keyframe">◆</span>}
    </button>
  );
});
