import { useState } from "react";
import type { LayerState, Placement } from "@memegen/shared";
import { Slider, Text, TextField } from "@memegen/ui";

export interface PlacementFieldsProps {
  /** The layer's position/opacity at the current frame. */
  state: LayerState;
  animated: boolean;
  onPlace: (patch: Placement) => void;
}

/** X/Y/opacity at the current frame (static, or as a keyframe when the layer is animated). */
export function PlacementFields({ state, animated, onPlace }: PlacementFieldsProps) {
  return (
    <>
      <div className="field-row">
        <PercentField label="X %" value={state.x} onChange={(x) => onPlace({ x })} />
        <PercentField label="Y %" value={state.y} onChange={(y) => onPlace({ y })} />
        <Slider
          label={`Opacity ${Math.round(state.opacity * 100)}%`}
          className="grow"
          min={0}
          max={100}
          step={1}
          value={Math.round(state.opacity * 100)}
          onChange={(e) => onPlace({ opacity: Number(e.target.value) / 100 })}
        />
      </div>
      {animated && (
        <Text tone="muted" size="sm">
          Animated: position/opacity edits set a keyframe at the current frame.
        </Text>
      )}
    </>
  );
}

/** Number input in percent; keeps what is typed (even empty) while focused and only reports real numbers. */
function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (fraction: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      label={label}
      className="number-field"
      type="number"
      step={1}
      value={draft ?? Math.round(value * 100)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const percent = Number(text);
        if (text.trim() !== "" && Number.isFinite(percent)) onChange(percent / 100);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
