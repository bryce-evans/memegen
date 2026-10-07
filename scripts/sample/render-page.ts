/**
 * Browser entry bundled by `seed.ts`: renders a meme with the same code path as the editor's export
 * (`ensureLayerFonts` + `ensureLayerImages` + `decodeMedia` + `exportMeme`), so seeded memes look exactly like user-made ones.
 * Assets are fetched from `/assets/<id>`, which the seed script serves from the asset store.
 */
import { canvasHeight, decodeMedia, ensureLayerFonts, ensureLayerImages, exportMeme } from "@memegen/render";
import { stillExportSize, type Layer, type MediaKind, type UploadLimits } from "@memegen/shared";

export interface RenderRequest {
  sourceAssetId: string;
  kind: MediaKind;
  layers: Layer[];
  limits: UploadLimits;
}

export interface RenderResponse {
  base64: string;
  extension: string;
}

const assetUrl = (id: string) => `/assets/${id}`;

async function renderMeme({ sourceAssetId, kind, layers, limits }: RenderRequest): Promise<RenderResponse> {
  const [, images] = await Promise.all([ensureLayerFonts(layers, assetUrl), ensureLayerImages(layers, assetUrl)]);
  const res = await fetch(assetUrl(sourceAssetId));
  if (!res.ok) throw new Error(`source asset ${sourceAssetId}: ${res.status}`);
  const media = await decodeMedia(await res.blob(), kind);
  const out = await exportMeme(media, layers, images, { stillSize: stillExportSize(media.width, canvasHeight(layers, media.width, media.height), limits) });
  const bytes = new Uint8Array(await out.blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), extension: out.extension };
}

declare global {
  var renderMeme: (req: RenderRequest) => Promise<RenderResponse>;
}
globalThis.renderMeme = renderMeme;
