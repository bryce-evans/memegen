import { frameIndexAt, type DecodedMedia } from "@memegen/render";
import { addKeyframeAt, clearAnimation, removeKeyframe, setWindow, type TextLayer, type WindowEdge } from "@memegen/shared";
import { Button, Icon, IconButton, Inline, Panel, Text } from "@memegen/ui";
import { AnimationPreview } from "./AnimationPreview.tsx";

export interface AnimationPanelProps {
  layer: TextLayer;
  /** Every layer, for the preview. */
  layers: readonly TextLayer[];
  media: DecodedMedia;
  frame: number;
  onChange: (update: (layer: TextLayer) => TextLayer) => void;
  onSeek: (frame: number) => void;
}

const WINDOW_EDGES: WindowEdge[] = ["start", "end"];
const WINDOW_TEXT: Record<WindowEdge, { label: string; empty: string }> = {
  start: { label: "Shown from", empty: "the start" },
  end: { label: "Shown until", empty: "the end" },
};

/** Visibility window and keyframes of one layer (animated media only), then a looping preview of the whole meme. */
export function AnimationPanel({ layer, layers, media, frame, onChange, onSeek }: AnimationPanelProps) {
  const t = media.times[frame] ?? 0;
  return (
    <Panel variant="inset" heading="Animation" className="animation">
      {WINDOW_EDGES.map((edge) => (
        <WindowRow key={edge} edge={edge} value={layer[edge]} t={t} onSet={(value) => onChange((l) => setWindow(l, edge, value))} />
      ))}

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
      <AnimationPreview media={media} layers={layers} />
    </Panel>
  );
}

function WindowRow({ edge, value, t, onSet }: { edge: WindowEdge; value: number | null; t: number; onSet: (value: number | null) => void }) {
  const { label, empty } = WINDOW_TEXT[edge];
  return (
    <Inline wrap={false} className="window-row">
      <Text as="span" size="sm" className="grow">
        {label} {value === null ? empty : `${value.toFixed(2)}s`}
      </Text>
      <Button size="sm" data-testid={`set-${edge}`} onClick={() => onSet(t)}>
        Set to current
      </Button>
      <Button size="sm" variant="quiet" onClick={() => onSet(null)} disabled={value === null}>
        Clear
      </Button>
    </Inline>
  );
}
