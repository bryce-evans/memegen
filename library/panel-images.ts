import type { PanelSet } from "@memegen/shared";
import { cropPixels, manifestPanelSet, type ManifestPanelTemplate } from "./manifest.ts";

export interface CroppedPanelImages {
  set: PanelSet;
  images: Map<string, ImageBitmap>;
  dispose(): void;
}

/** Browser-only crop preparation shared by library preview and ingestion. The caller owns all returned bitmaps. */
export async function cropPanelImages(
  entry: ManifestPanelTemplate,
  source: ImageBitmapSource,
  width: number,
  height: number,
): Promise<CroppedPanelImages> {
  const images = new Map<string, ImageBitmap>();
  const dispose = () => { for (const image of images.values()) image.close(); };
  try {
    for (const [index, item] of entry.panels.items.entries()) {
      const crop = cropPixels(item.crop, width, height);
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      images.set(id, await createImageBitmap(source, crop.x, crop.y, crop.width, crop.height));
    }
    return { set: manifestPanelSet(entry, [...images.keys()]), images, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
