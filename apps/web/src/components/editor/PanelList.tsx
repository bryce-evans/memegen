import {
  MAX_PANELS,
  PANEL_FONT_SIZE_MAX,
  PANEL_FONT_SIZE_MIN,
  TEXT_MAX_LENGTH,
  type Asset,
  type Panel as MemePanel,
  type PanelLayout,
  type PanelSet,
} from "@memegen/shared";
import { Button, cx, Icon, IconButton, Panel, SegmentedControl, Slider, TextArea } from "@memegen/ui";
import { contentUrl } from "../../api.ts";

export interface PanelListProps {
  /** "Panels" for a meme; "Default Setup" while authoring a template, whose panels become its defaults. */
  heading: string;
  layout: PanelLayout;
  grid: boolean;
  /** Max caption size in units (`PanelSet.fontSize`). */
  fontSize: number;
  panels: MemePanel[];
  pack: Asset[];
  selectedId: string | null;
  /** Change the layout, grid, or caption size of the whole set. */
  onStyle: (changes: Partial<Pick<PanelSet, "layout" | "grid" | "fontSize">>) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onUpdate: (id: string, changes: Partial<Pick<MemePanel, "assetId" | "text">>) => void;
}

const LAYOUT_OPTIONS = [
  { value: "vertical", label: "Vertical", testId: "layout-vertical" },
  { value: "horizontal", label: "Horizontal", testId: "layout-horizontal" },
] as const;

const GRID_OPTIONS = [
  { value: "on", label: "Grid", testId: "grid-show" },
  { value: "off", label: "No grid", testId: "grid-hide" },
] as const;

/**
 * Multi-panel side panel: the layout, grid, and caption size, then one card per panel with its caption and which pack
 * image it shows. Picking an image only changes the panel's reference to it; the image itself is never edited.
 */
export function PanelList(props: PanelListProps) {
  const { heading, layout, grid, fontSize, panels, pack, selectedId, onStyle, onSelect, onAdd, onRemove, onMove, onUpdate } = props;
  return (
    <Panel
      heading={heading}
      className="layer-panel"
      headingActions={
        <Button
          size="sm"
          icon={<Icon name="plus" />}
          data-testid="add-panel"
          disabled={pack.length === 0 || panels.length >= MAX_PANELS}
          title={panels.length >= MAX_PANELS ? `At most ${MAX_PANELS} panels` : undefined}
          onClick={onAdd}
        >
          Add panel
        </Button>
      }
    >
      <div className="panel-style">
        <SegmentedControl<PanelLayout> aria-label="Layout" size="sm" options={LAYOUT_OPTIONS} value={layout} onChange={(v) => onStyle({ layout: v })} />
        <SegmentedControl<"on" | "off">
          aria-label="Grid"
          size="sm"
          options={GRID_OPTIONS}
          value={grid ? "on" : "off"}
          onChange={(v) => onStyle({ grid: v === "on" })}
        />
      </div>
      <Slider
        label={`Text size ${Math.round(fontSize * 100)}%`}
        min={PANEL_FONT_SIZE_MIN * 100}
        max={PANEL_FONT_SIZE_MAX * 100}
        step={1}
        value={Math.round(fontSize * 100)}
        onChange={(e) => onStyle({ fontSize: Number(e.target.value) / 100 })}
        data-testid="panel-font-size"
      />
      <ol className="layer-list">
        {panels.map((panel, i) => {
          const name = `Panel ${i + 1}`;
          return (
            <li key={panel.id} data-testid="panel-item" data-panel-id={panel.id} className={cx("layer-row", panel.id === selectedId && "selected")}>
              <Panel
                variant="inset"
                heading={name}
                className="layer-card"
                headingActions={
                  <div className="layer-card-actions">
                    <IconButton size="sm" variant="quiet" onClick={() => onMove(panel.id, -1)} disabled={i === 0} label="Move earlier">
                      <Icon name="up" />
                    </IconButton>
                    <IconButton size="sm" variant="quiet" onClick={() => onMove(panel.id, 1)} disabled={i === panels.length - 1} label="Move later">
                      <Icon name="down" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="quiet"
                      className="danger-icon"
                      onClick={() => onRemove(panel.id)}
                      disabled={panels.length === 1}
                      label="Remove panel"
                      data-testid="remove-panel"
                    >
                      <Icon name="close" />
                    </IconButton>
                  </div>
                }
              >
                <TextArea
                  aria-label={`${name} text`}
                  rows={1}
                  className="layer-row-text"
                  data-testid="panel-text"
                  value={panel.text}
                  maxLength={TEXT_MAX_LENGTH}
                  onFocus={() => onSelect(panel.id)}
                  onChange={(e) => onUpdate(panel.id, { text: e.target.value })}
                />
                <SegmentedControl<string>
                  aria-label={`${name} image`}
                  size="sm"
                  className="panel-images"
                  value={panel.assetId}
                  onChange={(assetId) => {
                    onSelect(panel.id);
                    onUpdate(panel.id, { assetId });
                  }}
                  options={pack.map((asset, j) => ({
                    value: asset.id,
                    testId: "panel-image",
                    title: `Image ${j + 1}: ${asset.filename}`,
                    label: <img className="panel-thumb" src={contentUrl(asset)} alt={`Image ${j + 1}`} />,
                  }))}
                />
              </Panel>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
