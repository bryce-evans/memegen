import { useState, type ReactNode } from "react";
import { frameIndexAt, type DecodedMedia } from "@memegen/render";
import { layerStateAt, TEXT_STYLES, upsertKeyframe, type Asset, type TextAlign, type TextLayer, type TextStyle } from "@memegen/shared";
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
    <div className="panel layer-panel">
      <div className="panel-head">
        <h3>Layers</h3>
        <button type="button" data-testid="add-layer" onClick={onAdd}>
          + Add text
        </button>
      </div>
      <ol className="layer-list">
        {layers.map((layer, i) => (
          <li key={layer.id} data-testid="layer-item" data-layer-id={layer.id} className={layer.id === selectedId ? "selected" : ""}>
            <button type="button" className="layer-name" onClick={() => onSelect(layer.id)}>
              {layer.text.split("\n")[0]?.trim() || "(empty)"}
              {layer.keyframes.length > 0 && <span className="badge">anim</span>}
            </button>
            <button type="button" onClick={() => onMoveOrder(layer.id, -1)} disabled={i === 0} aria-label="Move back (drawn behind)">
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMoveOrder(layer.id, 1)}
              disabled={i === layers.length - 1}
              aria-label="Move forward (drawn on top)"
            >
              ↓
            </button>
            <button type="button" className="danger" onClick={() => onRemove(layer.id)} aria-label="Remove layer">
              ✕
            </button>
          </li>
        ))}
      </ol>
      {layers.length === 0 ? <p className="muted">No text layers. Add one to start.</p> : <p className="muted small">Lower in the list draws on top.</p>}
      {selected ? <LayerEditor {...props} layer={selected} /> : layers.length > 0 && <p className="muted">Select a layer to edit it.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
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
      <Field label="Text">
        <textarea
          rows={3}
          data-testid="layer-text"
          value={layer.text}
          maxLength={2000}
          onChange={(e) => update({ text: e.target.value })}
        />
      </Field>

      <Field label="Font">
        <div className="row">
          <select
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
          </select>
          {user && (
            <label className="button file-button">
              {fontBusy ? "Uploading…" : "Upload font"}
              <input
                type="file"
                data-testid="font-upload"
                accept={FONT_ACCEPT}
                disabled={fontBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadFont(file);
                }}
              />
            </label>
          )}
        </div>
      </Field>
      {fontError !== null && <ErrorView error={fontError} testId="editor-error" />}

      <Field label={`Max size ${(layer.fontSize * 100).toFixed(1)}% of height`}>
        <input
          type="range"
          min={1}
          max={50}
          step={0.5}
          value={layer.fontSize * 100}
          onChange={(e) => update({ fontSize: Number(e.target.value) / 100 })}
        />
      </Field>

      <div className="row">
        <Field label="Color">
          <input type="color" value={layer.color.slice(0, 7)} onChange={(e) => update({ color: e.target.value })} />
        </Field>
        <Field label="Outline">
          <input type="color" value={layer.strokeColor.slice(0, 7)} onChange={(e) => update({ strokeColor: e.target.value })} />
        </Field>
        <Field label={`Outline width ${Math.round(layer.strokeWidth * 100)}%`}>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={Math.round(layer.strokeWidth * 100)}
            onChange={(e) => update({ strokeWidth: Number(e.target.value) / 100 })}
          />
        </Field>
      </div>

      <div className="row">
        <Field label="Align">
          <div className="segmented">
            {ALIGNS.map((a) => (
              <button key={a} type="button" className={layer.align === a ? "active" : ""} onClick={() => update({ align: a })}>
                {a}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Case">
          <select data-testid="layer-style" value={layer.textStyle} onChange={(e) => update({ textStyle: e.target.value as TextStyle })}>
            {TEXT_STYLES.map((s) => (
              <option key={s} value={s}>
                {STYLE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={`Rotation ${layer.angle}°`}>
        <input type="range" min={-180} max={180} step={1} value={layer.angle} onChange={(e) => update({ angle: Number(e.target.value) })} />
      </Field>

      <div className="row">
        <Field label={`Box width ${Math.round(layer.maxWidth * 100)}%`}>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={Math.round(layer.maxWidth * 100)}
            onChange={(e) => update({ maxWidth: Number(e.target.value) / 100 })}
          />
        </Field>
        <Field label={`Box height ${Math.round(layer.maxHeight * 100)}%`}>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={Math.round(layer.maxHeight * 100)}
            onChange={(e) => update({ maxHeight: Number(e.target.value) / 100 })}
          />
        </Field>
      </div>

      <div className="row">
        <Field label="X %">
          <input
            type="number"
            step={1}
            value={Math.round(state.x * 100)}
            onChange={(e) => onPlace(layer.id, { x: Number(e.target.value) / 100 })}
          />
        </Field>
        <Field label="Y %">
          <input
            type="number"
            step={1}
            value={Math.round(state.y * 100)}
            onChange={(e) => onPlace(layer.id, { y: Number(e.target.value) / 100 })}
          />
        </Field>
        <Field label={`Opacity ${Math.round(state.opacity * 100)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(state.opacity * 100)}
            onChange={(e) => onPlace(layer.id, { opacity: Number(e.target.value) / 100 })}
          />
        </Field>
      </div>
      {layer.keyframes.length > 0 && <p className="muted small">Animated: position/opacity edits set a keyframe at the current frame.</p>}

      {animated && (
        <fieldset className="animation">
          <legend>Animation</legend>
          <div className="row">
            <span>Shown from {layer.start === null ? "the start" : `${layer.start.toFixed(2)}s`}</span>
            <button type="button" data-testid="set-start" onClick={() => setWindow("start", t)}>
              Set to current
            </button>
            <button type="button" onClick={() => setWindow("start", null)} disabled={layer.start === null}>
              Clear
            </button>
          </div>
          <div className="row">
            <span>Shown until {layer.end === null ? "the end" : `${layer.end.toFixed(2)}s`}</span>
            <button type="button" data-testid="set-end" onClick={() => setWindow("end", t)}>
              Set to current
            </button>
            <button type="button" onClick={() => setWindow("end", null)} disabled={layer.end === null}>
              Clear
            </button>
          </div>

          <div className="panel-head">
            <h4>Keyframes</h4>
            <button
              type="button"
              data-testid="add-keyframe"
              onClick={() => update({ keyframes: upsertKeyframe(layer.keyframes, { t, x: state.x, y: state.y, opacity: state.opacity }) })}
            >
              Add keyframe at current frame
            </button>
          </div>
          {layer.keyframes.length === 0 ? (
            <p className="muted small">No keyframes: the layer stays put. Add keyframes on different frames, then drag the text to animate it.</p>
          ) : (
            <ul className="keyframes">
              {layer.keyframes.map((k) => {
                const kfFrame = frameIndexAt(media.times, k.t);
                return (
                  <li key={k.t} data-testid="keyframe-item" className={kfFrame === frame ? "current" : ""}>
                    <span>
                      {k.t.toFixed(2)}s (#{kfFrame + 1}) · x {Math.round(k.x * 100)}% · y {Math.round(k.y * 100)}% · α{" "}
                      {Math.round(k.opacity * 100)}%
                    </span>
                    <button type="button" onClick={() => onSeek(kfFrame)}>
                      Go
                    </button>
                    <button
                      type="button"
                      className="danger"
                      aria-label="Delete keyframe"
                      onClick={() =>
                        update(
                          layer.keyframes.length === 1
                            ? { keyframes: [], x: k.x, y: k.y, opacity: k.opacity }
                            : { keyframes: layer.keyframes.filter((x) => x !== k) },
                        )
                      }
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            disabled={layer.keyframes.length === 0 && layer.start === null && layer.end === null}
            onClick={() => update({ keyframes: [], start: null, end: null, x: state.x, y: state.y, opacity: state.opacity })}
          >
            Clear animation
          </button>
        </fieldset>
      )}
    </div>
  );
}
