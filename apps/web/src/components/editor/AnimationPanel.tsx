import { useState } from "react";
import { frameIndexAt, type DecodedMedia } from "@memegen/render";
import { addKeyframeAt, clearAnimation, removeKeyframe, type TextLayer, type WindowEdge } from "@memegen/shared";
import { Button, Icon, IconButton, Inline, Panel, Text, TextField } from "@memegen/ui";
import { clampEdgeFrame, setEdgeFrame, windowFrames } from "./windowFrames.ts";

export interface AnimationPanelProps {
  layer: TextLayer;
  media: DecodedMedia;
  frame: number;
  onChange: (update: (layer: TextLayer) => TextLayer) => void;
  onSeek: (frame: number) => void;
}

/** Visibility window and keyframes of one layer (animated media only). The whole-meme preview is its own card. */
export function AnimationPanel({ layer, media, frame, onChange, onSeek }: AnimationPanelProps) {
  const t = media.times[frame] ?? 0;
  return (
    <Panel variant="inset" heading="Animation" className="animation">
      <WindowFields layer={layer} media={media} onChange={onChange} onSeek={onSeek} />

      <Inline justify="between" className="keyframes-head">
        <h5 className="keyframes-title">Keyframes</h5>
        <Button size="sm" icon={<Icon name="plus" />} data-testid="add-keyframe" onClick={() => onChange((l) => addKeyframeAt(l, t))}>
          Add keyframe at current frame
        </Button>
      </Inline>
      {layer.keyframes.length === 0 ? (
        <Text tone="muted" size="sm">
          No keyframes: the layer stays put. Add keyframes on different frames, then drag the text to animate it.
        </Text>
      ) : (
        <ul className="keyframes">
          {layer.keyframes.map((k, i) => {
            const kfFrame = frameIndexAt(media.times, k.t);
            return (
              <li key={k.t} data-testid="keyframe-item" className={kfFrame === frame ? "current" : undefined}>
                <span>
                  {k.t.toFixed(2)}s (#{kfFrame + 1}) · x {Math.round(k.x * 100)}% · y {Math.round(k.y * 100)}% · α{" "}
                  {Math.round(k.opacity * 100)}%
                </span>
                <Button size="sm" variant="quiet" onClick={() => onSeek(kfFrame)}>
                  Go
                </Button>
                <IconButton size="sm" variant="quiet" className="danger-icon" label="Delete keyframe" onClick={() => onChange((l) => removeKeyframe(l, i))}>
                  <Icon name="close" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        size="sm"
        variant="danger"
        disabled={layer.keyframes.length === 0 && layer.start === null && layer.end === null}
        onClick={() => onChange((l) => clearAnimation(l, t))}
      >
        Clear animation
      </Button>
    </Panel>
  );
}

interface WindowFieldsProps {
  layer: TextLayer;
  media: DecodedMedia;
  onChange: AnimationPanelProps["onChange"];
  onSeek: (frame: number) => void;
}

/** The layer's visibility window as "Frame [first] to [last] of N" (1-based), each frame number editable. */
export function WindowFields({ layer, media, onChange, onSeek }: WindowFieldsProps) {
  const { times } = media;
  const frames = windowFrames(layer, times);
  const input = (edge: WindowEdge) => (
    <FrameInput
      edge={edge}
      value={frames[edge] + 1}
      max={times.length}
      onCommit={(n) => {
        const i = clampEdgeFrame(layer, edge, n - 1, times);
        onChange((l) => setEdgeFrame(l, edge, i, times));
        onSeek(i);
      }}
    />
  );
  return (
    <Inline wrap={false} className="window-row">
      <Text as="span" size="sm">
        Frame
      </Text>
      {input("start")}
      <Text as="span" size="sm">
        to
      </Text>
      {input("end")}
      <Text as="span" size="sm" tone="muted">
        of {times.length}
      </Text>
    </Inline>
  );
}

/**
 * A 1-based frame number. Keeps what is typed while focused (so it can be cleared and retyped); a whole number in
 * range applies at once, and leaving the field shows the stored, clamped value again.
 */
function FrameInput({ edge, value, max, onCommit }: { edge: WindowEdge; value: number; max: number; onCommit: (frame: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      type="number"
      size="sm"
      className="window-frame"
      data-testid={`window-${edge}`}
      aria-label={edge === "start" ? "First frame shown" : "Last frame shown"}
      min={1}
      max={max}
      step={1}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = e.target.valueAsNumber;
        if (Number.isInteger(n) && n >= 1 && n <= max) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
