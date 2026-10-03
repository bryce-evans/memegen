import { useState } from "react";
import { frameIndexAt, type DecodedMedia } from "@memegen/render";
import { layerStateAt, TEXT_STYLES, upsertKeyframe, type Asset, type TextAlign, type TextLayer, type TextStyle } from "@memegen/shared";
import {
  Badge,
  Button,
  ColorField,
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
import { uploadAsset } from "../../api.ts";
import { useAuth } from "../../auth.tsx";
import { FONT_ACCEPT } from "../../media.ts";
import { ErrorView } from "../common.tsx";

export interface LayerPanelProps {
  media: DecodedMedia;
  layers: TextLayer[];
  selectedId: string | null;
  frame: number;
  fonts: Asset[];
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMoveOrder: (id: string, delta: -1 | 1) => void;
  onUpdate: (id: string, patch: Partial<TextLayer>) => void;
  /** Change x/y/opacity at the current frame (static, or as a keyframe when animated). */
  onPlace: (id: string, state: { x?: number; y?: number; opacity?: number }) => void;
  onSeek: (frame: number) => void;
  onFontUploaded: (font: Asset) => void;
}

const STYLE_LABELS: Record<TextStyle, string> = { upper: "UPPER", lower: "lower", none: "As typed", mock: "mOcK" };
const ALIGNS: TextAlign[] = ["left", "center", "right"];

export function LayerPanel(props: LayerPanelProps) {
  const { layers, selectedId, onSelect, onAdd, onRemove, onMoveOrder } = props;
  const selected = layers.find((l) => l.id === selectedId) ?? null;

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
        {layers.map((layer, i) => (
          <li key={layer.id} data-testid="layer-item" data-layer-id={layer.id} className={layer.id === selectedId ? "selected" : undefined}>
            <Button
              size="sm"
              variant="quiet"
              className="layer-name"
              pressed={layer.id === selectedId}
              onClick={() => onSelect(layer.id)}
            >
              <span className="layer-name-text">{layer.text.split("\n")[0]?.trim() || "(empty)"}</span>
              {layer.keyframes.length > 0 && <Badge>anim</Badge>}
            </Button>
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
          </li>
        ))}
      </ol>
      {layers.length === 0 ? (
        <Text tone="muted">No text layers. Add one to start.</Text>
      ) : (
        <Text tone="muted" size="sm">
          Lower in the list draws on top.
        </Text>
      )}
      {selected ? <LayerEditor {...props} layer={selected} /> : layers.length > 0 && <Text tone="muted">Select a layer to edit it.</Text>}
    </Panel>
  );
}

function LayerEditor({ layer, media, frame, fonts, onUpdate, onPlace, onSeek, onFontUploaded }: LayerPanelProps & { layer: TextLayer }) {
  const { user } = useAuth();
  const [fontBusy, setFontBusy] = useState(false);
  const [fontError, setFontError] = useState<unknown>(null);
  const t = media.times[frame] ?? 0;
  const state = layerStateAt(layer, t);
  const animated = media.kind !== "image";
  const update = (patch: Partial<TextLayer>) => onUpdate(layer.id, patch);

  async function uploadFont(file: File) {
    setFontBusy(true);
    setFontError(null);
    try {
      const asset = await uploadAsset(file, file.name, file.name.replace(/\.[^.]+$/, ""));
      if (asset.kind !== "font") throw new Error(`${file.name} is not a font (detected ${asset.kind})`);
      onFontUploaded(asset);
    } catch (err) {
      setFontError(err);
    } finally {
      setFontBusy(false);
    }
  }

  function setWindow(edge: "start" | "end", value: number | null) {
    if (edge === "start") update({ start: value, end: value !== null && layer.end !== null && layer.end < value ? null : layer.end });
    else update({ end: value, start: value !== null && layer.start !== null && layer.start > value ? null : layer.start });
  }

  return (
    <div className="layer-editor">
      <TextArea label="Text" rows={3} data-testid="layer-text" value={layer.text} maxLength={2000} onChange={(e) => update({ text: e.target.value })} />

      <Field as="div" label="Font">
        <Inline wrap={false}>
          <SelectField
            aria-label="Font"
            className="font-select"
            data-testid="layer-font"
            value={layer.fontAssetId ?? ""}
            onChange={(e) => update({ fontAssetId: e.target.value || null })}
          >
            <option value="">Sans-serif (fallback)</option>
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </SelectField>
          {user && (
            <FileButton
              icon={<Icon name="upload" />}
              data-testid="font-upload"
              accept={FONT_ACCEPT}
              disabled={fontBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadFont(file);
              }}
            >
              {fontBusy ? "Uploading…" : "Upload font"}
            </FileButton>
          )}
        </Inline>
      </Field>
      {fontError !== null && <ErrorView error={fontError} testId="editor-error" />}

      <Slider
        label={`Max size ${(layer.fontSize * 100).toFixed(1)}% of height`}
        min={1}
        max={50}
        step={0.5}
        value={layer.fontSize * 100}
        onChange={(e) => update({ fontSize: Number(e.target.value) / 100 })}
      />

      <div className="field-row">
        <ColorField label="Color" value={layer.color.slice(0, 7)} onChange={(e) => update({ color: e.target.value })} />
        <ColorField label="Outline" value={layer.strokeColor.slice(0, 7)} onChange={(e) => update({ strokeColor: e.target.value })} />
        <Slider
          label={`Outline width ${Math.round(layer.strokeWidth * 100)}%`}
          className="grow"
          min={0}
          max={30}
          step={1}
          value={Math.round(layer.strokeWidth * 100)}
          onChange={(e) => update({ strokeWidth: Number(e.target.value) / 100 })}
        />
      </div>

      <div className="field-row">
        <Field as="div" label="Align">
          <SegmentedControl
            aria-label="Align"
            size="sm"
            value={layer.align}
            onChange={(a) => update({ align: a })}
            options={ALIGNS.map((a) => ({ value: a, label: a }))}
          />
        </Field>
        <SelectField
          label="Case"
          className="grow"
          data-testid="layer-style"
          value={layer.textStyle}
          onChange={(e) => update({ textStyle: e.target.value as TextStyle })}
        >
          {TEXT_STYLES.map((s) => (
            <option key={s} value={s}>
              {STYLE_LABELS[s]}
            </option>
          ))}
        </SelectField>
      </div>

      <Slider label={`Rotation ${layer.angle}°`} min={-180} max={180} step={1} value={layer.angle} onChange={(e) => update({ angle: Number(e.target.value) })} />

      <div className="field-row">
        <Slider
          label={`Box width ${Math.round(layer.maxWidth * 100)}%`}
          className="grow"
          min={5}
          max={100}
          step={1}
          value={Math.round(layer.maxWidth * 100)}
          onChange={(e) => update({ maxWidth: Number(e.target.value) / 100 })}
        />
        <Slider
          label={`Box height ${Math.round(layer.maxHeight * 100)}%`}
          className="grow"
          min={5}
          max={100}
          step={1}
          value={Math.round(layer.maxHeight * 100)}
          onChange={(e) => update({ maxHeight: Number(e.target.value) / 100 })}
        />
      </div>

      <div className="field-row">
        <TextField
          label="X %"
          className="number-field"
          type="number"
          step={1}
          value={Math.round(state.x * 100)}
          onChange={(e) => onPlace(layer.id, { x: Number(e.target.value) / 100 })}
        />
        <TextField
          label="Y %"
          className="number-field"
          type="number"
          step={1}
          value={Math.round(state.y * 100)}
          onChange={(e) => onPlace(layer.id, { y: Number(e.target.value) / 100 })}
        />
        <Slider
          label={`Opacity ${Math.round(state.opacity * 100)}%`}
          className="grow"
          min={0}
          max={100}
          step={1}
          value={Math.round(state.opacity * 100)}
          onChange={(e) => onPlace(layer.id, { opacity: Number(e.target.value) / 100 })}
        />
      </div>
      {layer.keyframes.length > 0 && (
        <Text tone="muted" size="sm">
          Animated: position/opacity edits set a keyframe at the current frame.
        </Text>
      )}

      {animated && (
        <Panel variant="inset" heading="Animation" className="animation">
          <Inline wrap={false} className="window-row">
            <Text as="span" size="sm" className="grow">
              Shown from {layer.start === null ? "the start" : `${layer.start.toFixed(2)}s`}
            </Text>
            <Button size="sm" data-testid="set-start" onClick={() => setWindow("start", t)}>
              Set to current
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setWindow("start", null)} disabled={layer.start === null}>
              Clear
            </Button>
          </Inline>
          <Inline wrap={false} className="window-row">
            <Text as="span" size="sm" className="grow">
              Shown until {layer.end === null ? "the end" : `${layer.end.toFixed(2)}s`}
            </Text>
            <Button size="sm" data-testid="set-end" onClick={() => setWindow("end", t)}>
              Set to current
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setWindow("end", null)} disabled={layer.end === null}>
              Clear
            </Button>
          </Inline>

          <Inline justify="between" className="keyframes-head">
            <h5 className="keyframes-title">Keyframes</h5>
            <Button
              size="sm"
              icon={<Icon name="plus" />}
              data-testid="add-keyframe"
              onClick={() => update({ keyframes: upsertKeyframe(layer.keyframes, { t, x: state.x, y: state.y, opacity: state.opacity }) })}
            >
              Add keyframe at current frame
            </Button>
          </Inline>
          {layer.keyframes.length === 0 ? (
            <Text tone="muted" size="sm">
              No keyframes: the layer stays put. Add keyframes on different frames, then drag the text to animate it.
            </Text>
          ) : (
            <ul className="keyframes">
              {layer.keyframes.map((k) => {
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
                    <IconButton
                      size="sm"
                      variant="quiet"
                      className="danger-icon"
                      label="Delete keyframe"
                      onClick={() =>
                        update(
                          layer.keyframes.length === 1
                            ? { keyframes: [], x: k.x, y: k.y, opacity: k.opacity }
                            : { keyframes: layer.keyframes.filter((x) => x !== k) },
                        )
                      }
                    >
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
            onClick={() => update({ keyframes: [], start: null, end: null, x: state.x, y: state.y, opacity: state.opacity })}
          >
            Clear animation
          </Button>
        </Panel>
      )}
    </div>
  );
}
