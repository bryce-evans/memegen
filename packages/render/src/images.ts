import type { Layer } from "@memegen/shared";

/** Decoded image-layer assets by asset id, as `drawLayers` needs them. */
export type LayerImages = ReadonlyMap<string, ImageBitmap>;

// Asset content is immutable, so each image is fetched and decoded once per page.
const loaded = new Map<string, Promise<ImageBitmap>>();

export function loadLayerImage(assetId: string, url: string): Promise<ImageBitmap> {
  let p = loaded.get(assetId);
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`image ${assetId}: HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => createImageBitmap(blob));
    // A failed load can be retried later.
    p.catch(() => loaded.delete(assetId));
    loaded.set(assetId, p);
  }
  return p;
}

/** Distinct image assets the layers reference. */
export function layerImageIds(layers: readonly Layer[]): string[] {
  return [...new Set(layers.flatMap((l) => (l.type === "image" ? [l.assetId] : [])))];
}

/** Load every image the layers reference. */
export async function ensureLayerImages(layers: readonly Layer[], urlFor: (assetId: string) => string): Promise<LayerImages> {
  const ids = layerImageIds(layers);
  const images = await Promise.all(ids.map((id) => loadLayerImage(id, urlFor(id))));
  return new Map(ids.map((id, i) => [id, images[i]!]));
}
