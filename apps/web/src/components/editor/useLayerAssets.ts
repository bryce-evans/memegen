import { useEffect, useState } from "react";
import { layerFontIds, layerImageIds, loadAssetImages, loadFont, type AssetImages } from "@memegen/render";
import type { Layer } from "@memegen/shared";
import { assetUrl } from "../../api.ts";

export interface LayerAssets {
  /** Bumped whenever a font finishes loading, so text is re-measured. */
  fontsVersion: number;
  /** Decoded image-layer assets, replaced once every referenced image is ready. */
  images: AssetImages;
  fontError: string | null;
  imageError: unknown;
}

/**
 * Load the fonts and images `layers` reference (each cached per asset by render). Each error is cleared whenever the
 * set of fonts or images changes, so removing the layer that failed clears it.
 */
export function useLayerAssets(layers: readonly Layer[]): LayerAssets {
  const [fontsVersion, setFontsVersion] = useState(0);
  const [fontError, setFontError] = useState<string | null>(null);
  const [images, setImages] = useState<AssetImages>(() => new Map());
  const [imageError, setImageError] = useState<unknown>(null);

  const fontKey = layerFontIds(layers).sort().join(",");
  useEffect(() => {
    setFontError(null);
    if (!fontKey) return;
    let cancelled = false;
    for (const id of fontKey.split(",")) {
      loadFont(id, assetUrl(id)).then(
        () => !cancelled && setFontsVersion((v) => v + 1),
        (err: unknown) => !cancelled && setFontError(`font failed to load: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [fontKey]);

  const imageKey = layerImageIds(layers).sort().join(",");
  useEffect(() => {
    setImageError(null);
    let cancelled = false;
    loadAssetImages(imageKey ? imageKey.split(",") : [], assetUrl).then(
      (loaded) => !cancelled && setImages(loaded),
      (err: unknown) => !cancelled && setImageError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  return { fontsVersion, images, fontError, imageError };
}
