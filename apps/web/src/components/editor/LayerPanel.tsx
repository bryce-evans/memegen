import { useState } from "react";
import type { DecodedMedia } from "@memegen/render";
import { layerLabel, layerStateAt, LAYER_NAME_MAX_LENGTH, placeAt, TEXT_ALIGNS, TEXT_MAX_LENGTH, TEXT_STYLES, type Asset, type TextLayer, type TextStyle } from "@memegen/shared";
import { Badge, Button, ColorField, cx, Field, Icon, IconButton, Panel, SegmentedControl, SelectField, Slider, Text, TextArea, TextField } from "@memegen/ui";
import { AnimationPanel, WindowFields } from "./AnimationPanel.tsx";
import { FontField } from "./FontField.tsx";
import { PlacementFields } from "./PlacementFields.tsx";

type LayerUpdate = (layer: TextLayer) => TextLayer;

export interface LayerPanelProps {
  /** Template editor: layer names are editable (they label the boxes for everyone who uses the template). */
  nameable: boolean;
  media: DecodedMedia;
  layers: TextLayer[];
  selectedId: string | null;
  frame: number;
  fonts: Asset[];
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMoveOrder: (id: string, delta: -1 | 1) => void;
  /** Replace a layer by applying `update` to its latest state. */
  onUpdate: (id: string, update: LayerUpdate) => void;
  onSeek: (frame: number) => void;
  onFontUploaded: (layerId: string, font: Asset) => void;
}

const STYLE_LABELS: Record<TextStyle, string> = { upper: "UPPER", lower: "lower", none: "As typed", mock: "mOcK" };

export function LayerPanel({ nameable, media, layers, selectedId, frame, fonts, onSelect, onAdd, onRemove, onMoveOrder, onUpdate, onSeek, onFontUploaded }: LayerPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Panel
      heading="Layers"
      className="layer-panel"
      headingActions={
        <Button size="sm" icon={<Icon name="plus" />} data-testid="add-layer" onClick={onAdd}>
          Add text
        </Button>
      }
    >
      <ol className="layer-list">
        {layers.map((layer, i) => {
          const open = layer.id === openId;
          const settingsId = `layer-settings-${layer.id}`;
          const name = layerLabel(layer, i);
          return (
            <li key={layer.id} data-testid="layer-item" data-layer-id={layer.id} className={cx("layer-row", layer.id === selectedId && "selected")}>
              <Panel
                variant="inset"
                heading={nameable ? undefined : name}
                headingActions={
                  <>
                    {nameable && (
                      <TextField
                        size="sm"
                        aria-label={`Layer ${i + 1} name`}
                        className="layer-name-input"
                        data-testid="layer-name-input"
                        value={layer.name ?? ""}
                        placeholder={layerLabel({}, i)}
                        maxLength={LAYER_NAME_MAX_LENGTH}
                        onChange={(e) => {
                          const value = e.target.value;
                          onUpdate(layer.id, (l) => ({ ...l, name: value }));
                        }}
                      />
                    )}
                    <div className="layer-card-actions">
                      {layer.keyframes.length > 0 && <Badge>anim</Badge>}
                      <IconButton
                        size="sm"
                        variant="quiet"
                        label={open ? "Hide layer settings" : "Edit layer settings"}
                        aria-expanded={open}
                        aria-controls={settingsId}
                        data-testid="layer-settings-toggle"
                        onClick={() => {
                          setOpenId(open ? null : layer.id);
                          onSelect(layer.id);
                        }}
                      >
                        <Icon name="edit" />
                      </IconButton>
                      <IconButton size="sm" variant="quiet" onClick={() => onMoveOrder(layer.id, -1)} disabled={i === 0} label="Move back (drawn behind)">
                        <Icon name="up" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="quiet"
                        onClick={() => onMoveOrder(layer.id, 1)}
                        disabled={i === layers.length - 1}
                        label="Move forward (drawn on top)"
                      >
                        <Icon name="down" />
                      </IconButton>
                      <IconButton size="sm" variant="quiet" className="danger-icon" onClick={() => onRemove(layer.id)} label="Remove layer">
                        <Icon name="close" />
                      </IconButton>
                    </div>
                  </>
                }
                className="layer-card"
              >
                <TextArea
                  aria-label={`${name} text`}
                  rows={1}
                  className="layer-row-text"
                  data-testid="layer-text"
                  value={layer.text}
                  maxLength={TEXT_MAX_LENGTH}
                  onFocus={() => onSelect(layer.id)}
                  onChange={(e) => {
                    const text = e.target.value;
                    onUpdate(layer.id, (l) => ({ ...l, text }));
                  }}
                />
                {/* GIF/video: the selected layer (focusing its text selects it) shows when it starts and stops; the
                    settings' Animation panel shows the same rows, so they appear here only while it is closed. */}
                {media.kind !== "image" && layer.id === selectedId && !open && (
                  <div className="layer-window" data-testid="layer-window">
                    <WindowFields layer={layer} media={media} onChange={(update) => onUpdate(layer.id, update)} onSeek={onSeek} />
                  </div>
                )}
                {open && (
                  <div id={settingsId} className="layer-settings" data-testid="layer-settings">
                    <LayerSettings
                      layer={layer}
                      media={media}
                      frame={frame}
                      fonts={fonts}
                      onChange={(update) => onUpdate(layer.id, update)}
                      onSeek={onSeek}
                      onFontUploaded={(font) => onFontUploaded(layer.id, font)}
                    />
                  </div>
                )}
              </Panel>
            </li>
          );
        })}
      </ol>
      {layers.length === 0 && <Text tone="muted">No text layers. Add one to start.</Text>}
    </Panel>
  );
}

interface LayerSettingsProps {
  layer: TextLayer;
  media: DecodedMedia;
  frame: number;
  fonts: Asset[];
  onChange: (update: LayerUpdate) => void;
  onSeek: (frame: number) => void;
  onFontUploaded: (font: Asset) => void;
}

/** Everything about a layer except its text: font, size, colors, layout, placement, and (animated media) keyframes. */
function LayerSettings({ layer, media, frame, fonts, onChange, onSeek, onFontUploaded }: LayerSettingsProps) {
  const t = media.times[frame] ?? 0;
  const set = (patch: Partial<TextLayer>) => onChange((l) => ({ ...l, ...patch }));

  return (
    <div className="layer-settings-fields">
      <FontField value={layer.fontAssetId} fonts={fonts} onChange={(fontAssetId) => set({ fontAssetId })} onUploaded={onFontUploaded} />

      <Slider
        label={`Max size ${(layer.fontSize * 100).toFixed(1)}% of height`}
        min={1}
        max={50}
        step={0.5}
        value={layer.fontSize * 100}
        onChange={(e) => set({ fontSize: Number(e.target.value) / 100 })}
      />

      <div className="field-row">
        <ColorField label="Color" value={layer.color.slice(0, 7)} onChange={(e) => set({ color: e.target.value })} />
        <ColorField label="Outline" value={layer.strokeColor.slice(0, 7)} onChange={(e) => set({ strokeColor: e.target.value })} />
        <Slider
          label={`Outline width ${Math.round(layer.strokeWidth * 100)}%`}
          className="grow"
          min={0}
          max={30}
          step={1}
          value={Math.round(layer.strokeWidth * 100)}
          onChange={(e) => set({ strokeWidth: Number(e.target.value) / 100 })}
        />
      </div>

      <div className="field-row">
        <Field as="div" label="Align">
          <SegmentedControl
            aria-label="Align"
            size="sm"
            value={layer.align}
            onChange={(align) => set({ align })}
            options={TEXT_ALIGNS.map((a) => ({ value: a, label: a }))}
          />
        </Field>
        <SelectField
          label="Case"
          className="grow"
          data-testid="layer-style"
          value={layer.textStyle}
          onChange={(e) => set({ textStyle: e.target.value as TextStyle })}
        >
          {TEXT_STYLES.map((s) => (
            <option key={s} value={s}>
              {STYLE_LABELS[s]}
            </option>
          ))}
        </SelectField>
      </div>

      <Slider label={`Rotation ${layer.angle}°`} min={-180} max={180} step={1} value={layer.angle} onChange={(e) => set({ angle: Number(e.target.value) })} />

      <div className="field-row">
        <Slider
          label={`Box width ${Math.round(layer.maxWidth * 100)}%`}
          className="grow"
          min={5}
          max={100}
          step={1}
          value={Math.round(layer.maxWidth * 100)}
          onChange={(e) => set({ maxWidth: Number(e.target.value) / 100 })}
        />
        <Slider
          label={`Box height ${Math.round(layer.maxHeight * 100)}%`}
          className="grow"
          min={5}
          max={100}
          step={1}
          value={Math.round(layer.maxHeight * 100)}
          onChange={(e) => set({ maxHeight: Number(e.target.value) / 100 })}
        />
      </div>

      <PlacementFields state={layerStateAt(layer, t)} animated={layer.keyframes.length > 0} onPlace={(patch) => onChange((l) => placeAt(l, t, patch))} />

      {media.kind !== "image" && (
        <AnimationPanel layer={layer} media={media} frame={frame} onChange={onChange} onSeek={onSeek} />
      )}
    </div>
  );
}
