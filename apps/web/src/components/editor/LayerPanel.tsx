import { useState } from "react";
import type { DecodedMedia } from "@memegen/render";
import {
  IMAGE_ACCEPT,
  layerLabel,
  layerStateAt,
  LAYER_NAME_MAX_LENGTH,
  placeAt,
  TEXT_ALIGNS,
  TEXT_MAX_LENGTH,
  TEXT_STYLES,
  type Asset,
  type Sticker,
  type ImageLayer,
  type Layer,
  type TextLayer,
  type TextStyle,
} from "@memegen/shared";
import {
  Badge,
  Button,
  ColorField,
  cx,
  Field,
  FileButton,
  Icon,
  IconButton,
  Inline,
  Panel,
  SegmentedControl,
  SelectField,
  Slider,
  Text,
  TextArea,
  TextField,
} from "@memegen/ui";
import { assetUrl } from "../../api.ts";
import { AnimationPanel, WindowFields } from "./AnimationPanel.tsx";
import { FontField } from "./FontField.tsx";
import { PlacementFields } from "./PlacementFields.tsx";
import { StickerPicker } from "./StickerPicker.tsx";

type LayerUpdate = (layer: Layer) => Layer;

export interface LayerPanelProps {
  /** Template editor: layer names are editable (they label the boxes for everyone who uses the template). */
  nameable: boolean;
  media: DecodedMedia;
  layers: Layer[];
  selectedId: string | null;
  frame: number;
  fonts: Asset[];
  /** An image is being checked and uploaded (from Add image or a paste). */
  addingImage: boolean;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  /** Add `file` as an image layer (checked against the image caps, then uploaded). */
  onAddImage: (file: File) => void;
  /** Add a library sticker as an image layer (its asset is already stored). */
  onAddSticker: (sticker: Sticker) => void;
  onRemove: (id: string) => void;
  onMoveOrder: (id: string, delta: -1 | 1) => void;
  /** Replace a layer by applying `update` to its latest state. */
  onUpdate: (id: string, update: LayerUpdate) => void;
  onSeek: (frame: number) => void;
  onFontUploaded: (layerId: string, font: Asset) => void;
}

const STYLE_LABELS: Record<TextStyle, string> = { upper: "UPPER", lower: "lower", none: "As typed", mock: "mOcK" };

export function LayerPanel(props: LayerPanelProps) {
  const { nameable, media, layers, selectedId, frame, fonts, addingImage, onSelect, onAdd, onAddImage, onAddSticker, onRemove, onMoveOrder, onUpdate, onSeek, onFontUploaded } =
    props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickingSticker, setPickingSticker] = useState(false);

  return (
    <Panel
      heading="Layers"
      className="layer-panel"
      headingActions={
        <Inline>
          <Button size="sm" icon={<Icon name="plus" />} data-testid="add-layer" onClick={onAdd}>
            Add text
          </Button>
          <FileButton
            size="sm"
            icon={<Icon name="upload" />}
            accept={IMAGE_ACCEPT}
            disabled={addingImage}
            title="Add an image layer (or paste one anywhere in the editor)"
            data-testid="add-image-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onAddImage(file);
            }}
          >
            {addingImage ? "Adding…" : "Add image"}
          </FileButton>
          <Button size="sm" icon={<Icon name="plus" />} data-testid="add-sticker" onClick={() => setPickingSticker(true)}>
            Add sticker
          </Button>
        </Inline>
      }
    >
      <StickerPicker open={pickingSticker} onClose={() => setPickingSticker(false)} onPick={onAddSticker} />
      <ol className="layer-list">
        {layers.map((layer, i) => {
          const open = layer.id === openId;
          const settingsId = `layer-settings-${layer.id}`;
          const name = layerLabel(layer, i);
          return (
            <li
              key={layer.id}
              data-testid="layer-item"
              data-layer-id={layer.id}
              data-layer-type={layer.type}
              className={cx("layer-row", layer.id === selectedId && "selected")}
            >
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
                        placeholder={layerLabel({ type: layer.type }, i)}
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
                {layer.type === "text" ? (
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
                      onUpdate(layer.id, (l) => (l.type === "text" ? { ...l, text } : l));
                    }}
                  />
                ) : (
                  <Button variant="quiet" className="layer-image-button" aria-label={`Select ${name}`} data-testid="layer-image" onClick={() => onSelect(layer.id)}>
                    <img className="layer-image-thumb" src={assetUrl(layer.assetId)} alt="" />
                  </Button>
                )}
                {/* GIF/video: the selected layer (focusing its text selects it) shows when it starts and stops; the
                    settings' Animation panel shows the same rows, so they appear here only while it is closed. */}
                {media.kind !== "image" && layer.id === selectedId && !open && (
                  <div className="layer-window" data-testid="layer-window">
                    <WindowFields layer={layer} media={media} onChange={(update) => onUpdate(layer.id, update)} onSeek={onSeek} />
                  </div>
                )}
                {open && (
                  <div id={settingsId} className="layer-settings" data-testid="layer-settings">
                    {layer.type === "text" ? (
                      <TextLayerSettings
                        layer={layer}
                        media={media}
                        frame={frame}
                        fonts={fonts}
                        onChange={(update) => onUpdate(layer.id, update)}
                        onSeek={onSeek}
                        onFontUploaded={(font) => onFontUploaded(layer.id, font)}
                      />
                    ) : (
                      <ImageLayerSettings layer={layer} media={media} frame={frame} onChange={(update) => onUpdate(layer.id, update)} onSeek={onSeek} />
                    )}
                  </div>
                )}
              </Panel>
            </li>
          );
        })}
      </ol>
      {layers.length === 0 && <Text tone="muted">No layers. Add text or an image (or paste one) to start.</Text>}
    </Panel>
  );
}

interface SettingsProps<L extends Layer> {
  layer: L;
  media: DecodedMedia;
  frame: number;
  onChange: (update: LayerUpdate) => void;
  onSeek: (frame: number) => void;
}

/** What every layer kind shares: rotation, placement, and (animated media) the visibility window and keyframes. */
function CommonSettings({ layer, media, frame, onChange, onSeek }: SettingsProps<Layer>) {
  const t = media.times[frame] ?? 0;
  return (
    <>
      <Slider
        label={`Rotation ${layer.angle}°`}
        min={-180}
        max={180}
        step={1}
        value={layer.angle}
        onChange={(e) => {
          const angle = Number(e.target.value);
          onChange((l) => ({ ...l, angle }));
        }}
      />
      <PlacementFields state={layerStateAt(layer, t)} animated={layer.keyframes.length > 0} onPlace={(patch) => onChange((l) => placeAt(l, t, patch))} />
      {media.kind !== "image" && <AnimationPanel layer={layer} media={media} frame={frame} onChange={onChange} onSeek={onSeek} />}
    </>
  );
}

/** Everything about a text layer except its text: font, size, colors, layout, then the shared settings. */
function TextLayerSettings(props: SettingsProps<TextLayer> & { fonts: Asset[]; onFontUploaded: (font: Asset) => void }) {
  const { layer, fonts, onChange, onFontUploaded } = props;
  const set = (patch: Partial<TextLayer>) => onChange((l) => (l.type === "text" ? { ...l, ...patch } : l));

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

      <CommonSettings {...props} />
    </div>
  );
}

/** An image layer's size (its height follows the image), then the shared settings. */
function ImageLayerSettings(props: SettingsProps<ImageLayer>) {
  const { layer, onChange } = props;
  return (
    <div className="layer-settings-fields">
      <Slider
        label={`Width ${Math.round(layer.width * 100)}% of the media`}
        min={2}
        max={200}
        step={1}
        value={Math.round(layer.width * 100)}
        data-testid="image-layer-width"
        onChange={(e) => {
          const width = Number(e.target.value) / 100;
          onChange((l) => (l.type === "image" ? { ...l, width } : l));
        }}
      />
      <CommonSettings {...props} />
    </div>
  );
}
