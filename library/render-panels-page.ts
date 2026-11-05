import { exportPanels, panelSetGrid } from "@memegen/render";
import { limitViolations, panelExportSize, type UploadLimits } from "@memegen/shared";
import type { ManifestPanelTemplate } from "./manifest.ts";
import { cropPanelImages } from "./panel-images.ts";

export interface PanelRenderRequest {
  entry: ManifestPanelTemplate;
  limits: UploadLimits;
}

export interface PanelImageOutput {
  base64: string;
  width: number;
  height: number;
}

export interface PanelRenderOutput {
  crops: PanelImageOutput[];
  cover: PanelImageOutput;
}

async function encoded(blob: Blob, width: number, height: number, limits: UploadLimits): Promise<PanelImageOutput> {
  const errors = limitViolations(blob.size, { kind: "image", width, height, frameCount: 1 }, limits);
  if (errors.length) throw new Error(errors.join("; "));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), width, height };
}

// ImageDecoder metadata distinguishes animated WebP/APNG from still images without a server decoder.
interface ImageDecoderMetadata {
  tracks: { ready: Promise<void>; selectedTrack: { animated: boolean } | null };
  close(): void;
}

async function renderPanelRecipe({ entry, limits }: PanelRenderRequest): Promise<PanelRenderOutput> {
  const response = await fetch("/source");
  if (!response.ok) throw new Error(`panel source: ${response.status}`);
  const blob = await response.blob();
  // Chromium exposes WebCodecs ImageDecoder; TypeScript's DOM library does not yet declare it.
  const codecs = globalThis as unknown as {
    ImageDecoder: new (options: { data: ArrayBuffer; type: string }) => ImageDecoderMetadata;
  };
  const Decoder = codecs.ImageDecoder;
  const decoder = new Decoder({ data: await blob.arrayBuffer(), type: blob.type });
  try {
    await decoder.tracks.ready;
    if (!decoder.tracks.selectedTrack || decoder.tracks.selectedTrack.animated) throw new Error("panel source must be a still image");
  } finally {
    decoder.close();
  }
  const image = await createImageBitmap(blob);
  try {
    const errors = limitViolations(blob.size, { kind: "image", width: image.width, height: image.height, frameCount: 1 }, limits);
    if (errors.length) throw new Error(errors.join("; "));
    const cropped = await cropPanelImages(entry, image, image.width, image.height);
    try {
      const crops: PanelImageOutput[] = [];
      for (const panel of cropped.set.panels) {
        const bitmap = cropped.images.get(panel.assetId)!;
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        crops.push(await encoded(await canvas.convertToBlob({ type: "image/png" }), bitmap.width, bitmap.height, limits));
      }
      const size = panelExportSize(panelSetGrid(cropped.set, cropped.images), limits);
      const cover = await exportPanels(cropped.set, cropped.images, size);
      return { crops, cover: await encoded(cover.blob, size.width, size.height, limits) };
    } finally {
      cropped.dispose();
    }
  } finally {
    image.close();
  }
}

declare global {
  var renderPanelRecipe: (request: PanelRenderRequest) => Promise<PanelRenderOutput>;
}
globalThis.renderPanelRecipe = renderPanelRecipe;
