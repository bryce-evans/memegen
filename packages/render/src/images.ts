import type { Layer } from "@memegen/shared";

/** Decoded still-image assets by asset id: image layers' images and multi-panel pack images. */
export type AssetImages = ReadonlyMap<string, ImageBitmap>;

// Asset content is immutable, so each image is fetched and decoded once per page and shared by every editor and
// export that draws it. The bitmaps live as long as the page: nobody closes them.
const loaded = new Map<string, Promise<ImageBitmap>>();

function loadAssetImage(assetId: string, url: string): Promise<ImageBitmap> {
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

/** Load the still images `ids` (cached per asset). */
export async function loadAssetImages(ids: readonly string[], urlFor: (assetId: string) => string): Promise<AssetImages> {
  const images = await Promise.all(ids.map((id) => loadAssetImage(id, urlFor(id))));
  return new Map(ids.map((id, i) => [id, images[i]!]));
}

/** Distinct image assets the layers reference. */
export function layerImageIds(layers: readonly Layer[]): string[] {
  return [...new Set(layers.flatMap((l) => (l.type === "image" ? [l.assetId] : [])))];
}

/** Load every image the layers reference. */
export function ensureLayerImages(layers: readonly Layer[], urlFor: (assetId: string) => string): Promise<AssetImages> {
  return loadAssetImages(layerImageIds(layers), urlFor);
}
