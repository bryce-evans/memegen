import { useEffect, useState } from "react";
import { decodeMedia, type DecodedMedia } from "@memegen/render";
import { topBottomLayers, type Asset, type Meme, type Template, type TextLayer, type UploadLimits } from "@memegen/shared";
import { fetchAssetBlob, getAsset, getLimits, getMeme, getTemplate, listFonts } from "../../api.ts";

/** What the editor opens, from the query string (`?meme=`, `?template=`, `?newTemplate=`, `?editTemplate=`). */
export interface SourceRef {
  kind: Source["kind"];
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

export interface Session {
  source: Source;
  media: DecodedMedia;
  layers: TextLayer[];
  fonts: Asset[];
  limits: UploadLimits;
}

export function sourceRef(params: URLSearchParams): SourceRef | null {
  const memeId = params.get("meme");
  if (memeId) return { kind: "meme", id: memeId };
  const templateId = params.get("template");
  if (templateId) return { kind: "template", id: templateId };
  const editId = params.get("editTemplate");
  if (editId) return { kind: "edit-template", id: editId };
  const assetId = params.get("newTemplate");
  return assetId ? { kind: "new-template", id: assetId } : null;
}

export function defaultFontId(fonts: Asset[]): string | null {
  return (fonts.find((f) => f.name.toLowerCase() === "impact") ?? fonts[0])?.id ?? null;
}

async function loadSource({ kind, id }: SourceRef): Promise<Source> {
  if (kind === "meme") return { kind, meme: await getMeme(id) };
  if (kind === "template" || kind === "edit-template") return { kind, template: await getTemplate(id) };
  return { kind, asset: await getAsset(id) };
}

function initialLayers(source: Source, fontId: string | null): TextLayer[] {
  if (source.kind === "meme") return source.meme.layers;
  // Editing works on the stored defaults themselves (ids kept); an empty list stays empty.
  if (source.kind === "edit-template") return source.template.defaultLayers;
  if (source.kind === "template" && source.template.defaultLayers.length) {
    return source.template.defaultLayers.map((l) => ({ ...structuredClone(l), id: crypto.randomUUID() }));
  }
  return topBottomLayers(undefined, undefined, fontId);
}

/** Load fonts, limits and the source, then decode its media; the media is disposed when the session goes away. */
export function useEditorSession(ref: SourceRef): { session: Session | null; error: unknown } {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { kind, id } = ref;

  useEffect(() => {
    let cancelled = false;
    let media: DecodedMedia | null = null;
    (async () => {
      const [fontPage, limits, source] = await Promise.all([listFonts(), getLimits(), loadSource({ kind, id })]);
      const asset = source.kind === "meme" ? source.meme.sourceAsset : source.kind === "new-template" ? source.asset : source.template.asset;
      if (asset.kind === "font") throw new Error("source asset is a font, not media");
      const decoded = await decodeMedia(await fetchAssetBlob(asset), asset.kind);
      if (cancelled) {
        decoded.dispose();
        return;
      }
      media = decoded;
      const fonts = fontPage.items;
      setSession({ source, media, layers: initialLayers(source, defaultFontId(fonts)), fonts, limits });
    })().catch((err: unknown) => !cancelled && setError(err));
    return () => {
      cancelled = true;
      media?.dispose();
    };
  }, [kind, id]);

  return { session, error };
}
