import { fontFamilyFor, type TextLayer } from "@memegen/shared";

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

/** Distinct font assets the layers reference. */
export function layerFontIds(layers: readonly TextLayer[]): string[] {
  return [...new Set(layers.map((l) => l.fontAssetId).filter((id): id is string => id !== null))];
}

/** Load every font the layers reference; text measured before this resolves uses a fallback. */
export async function ensureLayerFonts(layers: readonly TextLayer[], urlFor: (assetId: string) => string): Promise<void> {
  await Promise.all(layerFontIds(layers).map((id) => loadFont(id, urlFor(id))));
}
