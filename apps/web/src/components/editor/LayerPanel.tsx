import { useState } from "react";
import type { DecodedMedia } from "@memegen/render";
import {
  IMAGE_ACCEPT,
  layerLabel,
  layerStateAt,
  LAYER_NAME_MAX_LENGTH,
  TEXT_ALIGNS,
  TEXT_MAX_LENGTH,
  TEXT_STYLES,
  TOP_SECTION_HEIGHT_MAX,
  TOP_SECTION_HEIGHT_MIN,
  topSectionLayer,
  type Asset,
  type Sticker,
  type ImageLayer,
  type Layer,
  type Placement,
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
  /** An image is being checked and uploaded (from the Image button or a paste). */
  addingImage: boolean;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  /** Add `file` as an image layer (checked against the image caps, then uploaded). */
  onAddImage: (file: File) => void;
  /** Add a library sticker as an image layer (its asset is already stored). */
  onAddSticker: (sticker: Sticker) => void;
  onRemove: (id: string) => void;
  onMoveOrder: (id: string, delta: -1 | 1) => void;
  /** Switch the top section (a white band above the media with its own text layer, kept first) on or off. */
  onTopSection: (on: boolean) => void;
  /** Replace a layer by applying `update` to its latest state. */
  onUpdate: (id: string, update: LayerUpdate) => void;
  /** Move/fade a layer at the current frame (the editor clamps, allowing for the top section's band). */
  onPlace: (id: string, patch: Placement) => void;
  onSeek: (frame: number) => void;
  onFontUploaded: (layerId: string, font: Asset) => void;
}

const STYLE_LABELS: Record<TextStyle, string> = { upper: "UPPER", lower: "lower", none: "As typed", mock: "mOcK" };

export function LayerPanel(props: LayerPanelProps) {
  const { nameable, media, layers, selectedId, frame, fonts, addingImage, onSelect, onAdd, onAddImage, onAddSticker, onRemove, onMoveOrder, onTopSection, onUpdate, onPlace, onSeek, onFontUploaded } =
    props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickingSticker, setPickingSticker] = useState(false);
  const topSection = topSectionLayer(layers);

  return (
    <Panel heading="Layers" className="layer-panel">
      {/* One row under the heading: the add buttons (a group named "Add layer", so each reads as adding), then the
          Top section toggle. */}
      <Inline className="layer-panel-actions" gap="xs">
        <Inline role="group" aria-label="Add layer" gap="xs" wrap={false}>
          <Button size="sm" icon={<Icon name="plus" />} data-testid="add-layer" onClick={onAdd}>
            Text
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
            {addingImage ? "Adding…" : "Image"}
          </FileButton>
          <Button size="sm" icon={<Icon name="plus" />} title="Add a sticker from the library" data-testid="add-sticker" onClick={() => setPickingSticker(true)}>
            Sticker
          </Button>
        </Inline>
        <Button
          size="sm"
          pressed={topSection !== null}
          title="A white band above the media with its own text (Arial)"
          data-testid="top-section-toggle"
          onClick={() => onTopSection(topSection === null)}
        >
          Top section
        </Button>
      </Inline>
      <StickerPicker open={pickingSticker} onClose={() => setPickingSticker(false)} onPick={onAddSticker} />
      <ol className="layer-list">
        {layers.map((layer, i) => {
          const open = layer.id === openId;
          const settingsId = `layer-settings-${layer.id}`;
          // The top section's text is pinned as layer 0: it can't move, and nothing moves above it. Unnamed layers
          // keep their "Text N" numbers when it is switched on, so it doesn't count.
          const pinned = layer === topSection;
          const belowPinned = i > 0 && layers[i - 1] === topSection;
          const position = topSection && !pinned ? i - 1 : i;
          const name = layerLabel(layer, position);
          return (
            <li
              key={layer.id}
              data-testid="layer-item"
              data-layer-id={layer.id}
              data-layer-type={layer.type}
              data-top-section={pinned ? "true" : undefined}
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
                        placeholder={layerLabel({ type: layer.type }, position)}
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
                      <IconButton
                        size="sm"
                        variant="quiet"
                        onClick={() => onMoveOrder(layer.id, -1)}
                        disabled={i === 0 || pinned || belowPinned}
                        label="Move back (drawn behind)"
                      >
                        <Icon name="up" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="quiet"
                        onClick={() => onMoveOrder(layer.id, 1)}
                        disabled={i === layers.length - 1 || pinned}
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
                        onPlace={(patch) => onPlace(layer.id, patch)}
                        onSeek={onSeek}
                        onFontUploaded={(font) => onFontUploaded(layer.id, font)}
                      />
                    ) : (
                      <ImageLayerSettings
                        layer={layer}
                        media={media}
                        frame={frame}
                        onChange={(update) => onUpdate(layer.id, update)}
                        onPlace={(patch) => onPlace(layer.id, patch)}
                        onSeek={onSeek}
                      />
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
  onPlace: (patch: Placement) => void;
  onSeek: (frame: number) => void;
}

/** What every layer kind shares: rotation, placement, and (animated media) the visibility window and keyframes. */
function CommonSettings({ layer, media, frame, onChange, onPlace, onSeek }: SettingsProps<Layer>) {
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
      <PlacementFields state={layerStateAt(layer, t)} animated={layer.keyframes.length > 0} onPlace={onPlace} />
      {media.kind !== "image" && <AnimationPanel layer={layer} media={media} frame={frame} onChange={onChange} onSeek={onSeek} />}
    </>
  );
}

/** Everything about a text layer except its text: font, size, colors, layout, then the shared settings. */
function TextLayerSettings(props: SettingsProps<TextLayer> & { fonts: Asset[]; onFontUploaded: (font: Asset) => void }) {
  const { layer, fonts, onChange, onFontUploaded } = props;
  const set = (patch: Partial<TextLayer>) => onChange((l) => (l.type === "text" ? { ...l, ...patch } : l));
  const section = layer.topSection;

  return (
    <div className="layer-settings-fields">
      {section && (
        <Slider
          label={`Top section height ${Math.round(section.height * 100)}% of the width (each extra line adds its height)`}
          min={TOP_SECTION_HEIGHT_MIN * 100}
          max={TOP_SECTION_HEIGHT_MAX * 100}
          step={1}
          value={Math.round(section.height * 100)}
          data-testid="top-section-height"
          onChange={(e) => set({ topSection: { height: Number(e.target.value) / 100 } })}
        />
      )}
      <FontField
        value={layer.fontAssetId}
        fonts={fonts}
        fallbackLabel={section ? "Arial" : undefined}
        onChange={(fontAssetId) => set({ fontAssetId })}
        onUploaded={onFontUploaded}
      />

      <Slider
        label={`Max size ${(layer.fontSize * 100).toFixed(1)}% of ${section ? "the top section's height" : "height"}`}
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
