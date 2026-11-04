import { layersSchema, panelSetSchema, topBottomLayers, type Asset, type Layer, type PanelSet, type Template } from "@memegen/shared";

export function defaultFontId(fonts: Asset[]): string | null {
  return (fonts.find((f) => f.name.toLowerCase() === "impact") ?? fonts[0])?.id ?? null;
}

/** Template defaults shared by the Quick Creator and full editor; neither invents a different composition. */
export function templateLayers(template: Template, fontId: string | null): Layer[] {
  return template.defaultLayers.length ? template.defaultLayers : topBottomLayers(undefined, undefined, fontId);
}

export function templatePanels(template: Template): PanelSet {
  const spec = template.panels;
  if (!spec) throw new Error("this template has no image pack");
  return { layout: spec.layout, grid: spec.grid, mirror: spec.mirror, fontSize: spec.fontSize, panels: spec.defaultPanels };
}

/** History state for continuing the complete draft, never credentials or in-flight AI work. */
export type EditorDraft = { title: string } & (
  | { kind: "media"; layers: Layer[] }
  | { kind: "panels"; panels: PanelSet }
);

export function editorDraft(state: unknown): EditorDraft | null {
  if (typeof state !== "object" || state === null || !("draft" in state)) return null;
  const value = state.draft;
  if (typeof value !== "object" || value === null || !("title" in value) || typeof value.title !== "string" || !("kind" in value)) return null;
  if (value.kind === "media" && "layers" in value) {
    const parsed = layersSchema.safeParse(value.layers);
    return parsed.success ? { kind: "media", title: value.title, layers: parsed.data } : null;
  }
  if (value.kind === "panels" && "panels" in value) {
    const parsed = panelSetSchema.safeParse(value.panels);
    return parsed.success ? { kind: "panels", title: value.title, panels: parsed.data } : null;
  }
  return null;
}
