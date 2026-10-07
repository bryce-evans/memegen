import { fontFamilyFor, type Layer } from "@memegen/shared";

const loaded = new Map<string, Promise<void>>();

/** Register a font asset under its `mg-<id>` family; idempotent. */
export function loadFont(assetId: string, url: string): Promise<void> {
  let pending = loaded.get(assetId);
  if (!pending) {
    const face = new FontFace(fontFamilyFor(assetId), `url("${url}")`);
    pending = face.load().then((f) => {
      document.fonts.add(f);
    });
    pending.catch(() => loaded.delete(assetId));
    loaded.set(assetId, pending);
  }
  return pending;
}

/** Distinct font assets the text layers reference. */
export function layerFontIds(layers: readonly Layer[]): string[] {
  return [...new Set(layers.flatMap((l) => (l.type === "text" && l.fontAssetId !== null ? [l.fontAssetId] : [])))];
}

/** Load every font the layers reference; text measured before this resolves uses a fallback. */
export async function ensureLayerFonts(layers: readonly Layer[], urlFor: (assetId: string) => string): Promise<void> {
  await Promise.all(layerFontIds(layers).map((id) => loadFont(id, urlFor(id))));
}
