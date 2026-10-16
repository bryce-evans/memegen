import { useEffect, useState } from "react";
import { decodeMedia, loadAssetImages, type AssetImages, type DecodedMedia } from "@memegen/render";
import {
  PANEL_FONT_SIZE_DEFAULT,
  newTextLayer,
  topBottomLayers,
  type AiCaption,
  type Asset,
  type Meme,
  type PanelSet,
  type Template,
  type TextLayer,
  type Layer,
  type UploadLimits,
  type User,
} from "@memegen/shared";
import { assetUrl, fetchAssetBlob, getAsset, getLimits, getMeme, getTemplate, listFonts } from "../../api.ts";
import type { SavePanelProps } from "./SavePanel.tsx";

/**
 * What the editor opens, from the query string (`?meme=`, `?template=`, `?newTemplate=`, `?editTemplate=`,
 * `?newPanels`). Templates and memes open the multi-panel editor when their template has panels.
 */
export interface SourceRef {
  kind: Source["kind"] | "new-panels";
  /** Empty for `new-panels`. */
  id: string;
}

/** Where the media came from; decides how the meme is saved. */
export type Source =
  | { kind: "template"; template: Template }
  /** Uploaded media becoming a new template ("Template Editor"); its text boxes become the defaults. */
  | { kind: "new-template"; asset: Asset }
  /** An existing template's own text boxes, edited by its author and saved back as its defaults. */
  | { kind: "edit-template"; template: Template }
  | { kind: "meme"; meme: Meme };

/** Multi-panel editor sources; `new-panels` builds a new multi-panel template, its pack uploaded in the editor. */
export type PanelSource =
  | { kind: "template"; template: Template }
  | { kind: "edit-template"; template: Template }
  | { kind: "meme"; meme: Meme; template: Template }
  | { kind: "new-panels" };

export interface MediaSession {
  type: "media";
  source: Source;
  media: DecodedMedia;
  layers: Layer[];
  fonts: Asset[];
  limits: UploadLimits;
}

export interface PanelSession {
  type: "panels";
  source: PanelSource;
  pack: Asset[];
  /** Starting layout, style, and panels (empty for a new template until its pack has images). */
  set: PanelSet;
  /** Decoded pack images by asset id, from render's per-page image cache (`loadAssetImages`). */
  images: AssetImages;
  limits: UploadLimits;
}

export type Session = MediaSession | PanelSession;

export function sourceRef(params: URLSearchParams): SourceRef | null {
  const memeId = params.get("meme");
  if (memeId) return { kind: "meme", id: memeId };
  const templateId = params.get("template");
  if (templateId) return { kind: "template", id: templateId };
  const editId = params.get("editTemplate");
  if (editId) return { kind: "edit-template", id: editId };
  const assetId = params.get("newTemplate");
  if (assetId) return { kind: "new-template", id: assetId };
  return params.has("newPanels") ? { kind: "new-panels", id: "" } : null;
}

export function defaultFontId(fonts: Asset[]): string | null {
  return (fonts.find((f) => f.name.toLowerCase() === "impact") ?? fonts[0])?.id ?? null;
}

/** Editor page titles: shown while a source loads, and as the header of the template-authoring editors. */
export const EDITOR_TITLES: Record<SourceRef["kind"], string> = {
  meme: "Edit meme",
  template: "Loading template",
  "new-template": "Template Editor",
  "edit-template": "Edit template",
  "new-panels": "Multi-panel Template Editor",
};

/** SavePanel's target and defaults for a meme made from a template, or re-edited (saved only by its owner). */
export function memeSaveProps(
  source: { kind: "template"; template: Template } | { kind: "meme"; meme: Meme },
  user: User,
): Pick<SavePanelProps, "canSave" | "target" | "defaultTitle" | "templateTags"> {
  return source.kind === "meme"
    ? { canSave: source.meme.owner.id === user.id, target: { editing: source.meme }, defaultTitle: "", templateTags: [] }
    : { canSave: true, target: { templateId: source.template.id }, defaultTitle: source.template.name, templateTags: source.template.tags };
}

async function loadSource({ kind, id }: SourceRef): Promise<Source | { kind: "new-panels" }> {
  if (kind === "new-panels") return { kind };
  if (kind === "meme") return { kind, meme: await getMeme(id) };
  if (kind === "template" || kind === "edit-template") return { kind, template: await getTemplate(id) };
  return { kind, asset: await getAsset(id) };
}

/** The multi-panel view of a source, or null when its template is a single image/GIF/video. */
async function panelSource(source: Source | { kind: "new-panels" }): Promise<PanelSource | null> {
  switch (source.kind) {
    case "new-panels":
      return source;
    case "new-template":
      return null;
    case "meme":
      return source.meme.panels ? { kind: "meme", meme: source.meme, template: await getTemplate(source.meme.templateId) } : null;
    default:
      return source.template.kind === "multi" ? source : null;
  }
}

/** Look carried over from a template's first text box to AI-placed captions: font, size, colors, style. */
function captionStyle(source: Source): Partial<TextLayer> {
  const base = source.kind === "template" ? source.template.defaultLayers.find((l): l is TextLayer => l.type === "text" && !l.topSection) : undefined;
  if (!base) return {};
  const { fontAssetId, fontSize, color, strokeColor, strokeWidth, align, textStyle } = base;
  return { fontAssetId, fontSize, color, strokeColor, strokeWidth, align, textStyle };
}

function initialLayers(source: Source, fontId: string | null, captions: AiCaption[] | null): Layer[] {
  if (source.kind === "meme") return source.meme.layers;
  // Editing works on the stored defaults themselves (ids kept); an empty list stays empty.
  if (source.kind === "edit-template") return source.template.defaultLayers;
  // AI Creator: the model's captions replace the template's own text boxes.
  if (captions?.length) {
    const style = { fontAssetId: fontId, ...captionStyle(source) };
    return captions.map((c, i) =>
      newTextLayer({ ...style, name: `Text ${i + 1}`, text: c.text, x: c.x, y: c.y, maxWidth: c.width, maxHeight: c.height }),
    );
  }
  if (source.kind === "template" && source.template.defaultLayers.length) {
    return source.template.defaultLayers.map((l) => ({ ...structuredClone(l), id: crypto.randomUUID() }));
  }
  return topBottomLayers(undefined, undefined, fontId);
}

/** Pack and starting panel set for a multi-panel source. */
function initialPanels(source: PanelSource): { pack: Asset[]; set: PanelSet } {
  if (source.kind === "new-panels") {
    return { pack: [], set: { layout: "vertical", grid: true, mirror: false, fontSize: PANEL_FONT_SIZE_DEFAULT, panels: [] } };
  }
  const spec = source.template.panels;
  if (!spec) throw new Error("this template has no image pack");
  if (source.kind === "meme") return { pack: spec.pack, set: source.meme.panels! };
  // Editing works on the stored defaults (ids kept); using the template gives its panels fresh ids.
  const panels = source.kind === "edit-template" ? spec.defaultPanels : spec.defaultPanels.map((p) => ({ ...p, id: crypto.randomUUID() }));
  return { pack: spec.pack, set: { layout: spec.layout, grid: spec.grid, mirror: spec.mirror, fontSize: spec.fontSize, panels } };
}

/**
 * Load fonts, limits and the source, then decode its media (or, for a multi-panel template, its pack images); the
 * decoded media is released when the session goes away (pack images stay in render's per-page cache). `captions`
 * (from the AI Creator) become the starting text layers of a template or new-template source.
 */
export function useEditorSession(ref: SourceRef, captions: AiCaption[] | null = null): { session: Session | null; error: unknown } {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { kind, id } = ref;

  useEffect(() => {
    let cancelled = false;
    let media: DecodedMedia | null = null;
    (async () => {
      const [fontPage, limits, loaded] = await Promise.all([listFonts(), getLimits(), loadSource({ kind, id })]);
      const panels = await panelSource(loaded);
      if (panels) {
        const start = initialPanels(panels);
        const images = await loadAssetImages(start.pack.map((a) => a.id), assetUrl);
        if (!cancelled) setSession({ type: "panels", source: panels, ...start, images, limits });
        return;
      }
      if (loaded.kind === "new-panels") throw new Error("unreachable: new-panels is always a panel source");
      const asset = loaded.kind === "meme" ? loaded.meme.sourceAsset : loaded.kind === "new-template" ? loaded.asset : loaded.template.asset;
      if (asset.kind === "font") throw new Error("source asset is a font, not media");
      const decoded = await decodeMedia(await fetchAssetBlob(asset), asset.kind);
      if (cancelled) {
        decoded.dispose();
        return;
      }
      media = decoded;
      const fonts = fontPage.items;
      setSession({ type: "media", source: loaded, media, layers: initialLayers(loaded, defaultFontId(fonts), captions), fonts, limits });
    })().catch((err: unknown) => !cancelled && setError(err));
    return () => {
      cancelled = true;
      media?.dispose();
    };
  }, [kind, id]);

  return { session, error };
}
