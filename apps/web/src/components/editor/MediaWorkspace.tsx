import { useEffect, useRef, useState } from "react";
import { composedSize, ensureLayerFonts, ensureLayerImages, exportMeme } from "@memegen/render";
import {
  LAYER_NAME_MAX_LENGTH,
  layerAbove,
  newImageLayer,
  newTextLayer,
  placeAt,
  resizeImage,
  resizeTextBox,
  rotateTo,
  type Asset,
  type Placement,
  type Sticker,
} from "@memegen/shared";
import { Alert, PageHeader } from "@memegen/ui";
import { assetUrl, createTemplate, listFonts, updateTemplate, uploadAsset } from "../../api.ts";
import { useUser } from "../../auth.tsx";
import { plural } from "../../format.ts";
import { nameFromFile, precheckStillImage } from "../../media.ts";
import { ErrorView } from "../common.tsx";
import { TemplateDetails } from "../templateDetails.tsx";
import { LayerPanel } from "./LayerPanel.tsx";
import { PreviewPanel } from "./PreviewPanel.tsx";
import { SavePanel, type RenderProgress } from "./SavePanel.tsx";
import { defaultFontId, EDITOR_TITLES, memeSaveProps, type MediaSession } from "./session.ts";
import { Stage } from "./Stage.tsx";
import { TemplateEditPanel } from "./TemplateEditPanel.tsx";
import { TemplateSavePanel } from "./TemplateSavePanel.tsx";
import { Timeline } from "./Timeline.tsx";
import { useLayerAssets } from "./useLayerAssets.ts";
import { useLayerList } from "./useLayerList.ts";
import { usePlayback } from "./usePlayback.ts";

/**
 * The image/GIF/video editor: place text and image layers on the media, animate them over the frames, and save the
 * result as a meme, a new template's defaults, or an existing template's defaults.
 */
export function MediaWorkspace({ session }: { session: MediaSession }) {
  const { media, source, limits } = session;
  const user = useUser();
  const [fonts, setFonts] = useState<Asset[]>(session.fonts);
  const list = useLayerList(session.layers);
  const { layers, selectedId, update: updateLayer, select } = list;
  const assets = useLayerAssets(layers);
  const playback = usePlayback(media);
  const [addingImage, setAddingImage] = useState(false);
  /** Adding an image layer (upload or paste) failed. */
  const [addImageError, setAddImageError] = useState<unknown>(null);
  /** Set by pressing a text box on the stage; the Layers panel focuses that layer's text field. */
  const [editText, setEditText] = useState<{ id: string } | null>(null);
  // The stage shows just the finished meme (no handles or checkerboard); toggled beside the template's title.
  const [preview, setPreview] = useState(false);
  const animated = media.kind !== "image";
  const t = media.times[playback.frame] ?? 0;
  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
  const authoring = source.kind === "new-template" || source.kind === "edit-template";

  /** Move/fade a layer at the current frame; layers on the media can be placed up into the top section's band. */
  const composedHeight = composedSize(layers, media, media.width).height;
  function placeLayer(id: string, patch: Placement) {
    updateLayer(id, (l) => placeAt(l, t, patch, layerAbove(l, media.width, composedHeight, composedHeight - media.height)));
  }

  function addLayer() {
    list.add(newTextLayer({ name: `Text ${layers.length + 1}`, text: "TEXT", y: 0.5, fontAssetId: defaultFontId(fonts) }));
  }

  /** Add a stored still image centered, at its native width relative to the media but at most half the media's width. */
  function addImageLayer(assetId: string, pixelWidth: number, name: string) {
    list.add(newImageLayer(assetId, { name: name.slice(0, LAYER_NAME_MAX_LENGTH), width: Math.min(0.5, pixelWidth / media.width) }));
  }

  /** Check `file` against the image caps, upload it, and add it as an image layer. */
  async function addImageFile(file: File) {
    setAddImageError(null);
    setAddingImage(true);
    try {
      const { width } = await precheckStillImage(file, limits);
      const asset = await uploadAsset(file, file.name || "pasted.png");
      addImageLayer(asset.id, width, `Image ${layers.length + 1}`);
    } catch (err) {
      setAddImageError(err);
    } finally {
      setAddingImage(false);
    }
  }

  /** Stickers are stored PNGs with known sizes (the API checks both), so they go straight on as image layers. */
  function addSticker(sticker: Sticker) {
    addImageLayer(sticker.asset.id, sticker.asset.width ?? media.width, sticker.name);
  }

  // Pasting an image anywhere in the editor adds it as a layer; text pastes go where they normally would.
  const addImageRef = useRef(addImageFile);
  addImageRef.current = addImageFile;
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void addImageRef.current(file);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  async function fontUploaded(layerId: string, font: Asset) {
    try {
      setFonts((await listFonts()).items);
    } catch {
      setFonts((fs) => [...fs, font]);
    }
    updateLayer(layerId, (l) => (l.type === "text" ? { ...l, fontAssetId: font.id } : l));
  }

  async function render(signal: AbortSignal, progress: RenderProgress) {
    progress("Loading fonts and images", null);
    const [, images] = await Promise.all([ensureLayerFonts(layers, assetUrl), ensureLayerImages(layers, assetUrl)]);
    progress("Rendering", 0);
    return exportMeme(media, layers, images, limits, { signal, onProgress: (value) => progress("Rendering", value) });
  }

  const boxes = plural(layers.length, "layer", "layers");
  return (
    <>
      {authoring && <PageHeader title={EDITOR_TITLES[source.kind]} titleProps={{ "data-testid": "editor-title" }} />}
      <section className="editor">
        <div className="editor-main">
          <Stage
            media={media}
            layers={layers}
            images={assets.images}
            frame={playback.frame}
            selectedId={selectedId}
            fontsVersion={assets.fontsVersion}
            onSelect={select}
            onMove={(id, x, y) => placeLayer(id, { x, y })}
            onResize={(id, width, x, y) => {
              updateLayer(id, (l) => (l.type === "image" ? resizeImage(l, width) : l));
              placeLayer(id, { x, y });
            }}
            onResizeText={(id, maxWidth, maxHeight, x, y) => {
              updateLayer(id, (l) => (l.type === "text" ? resizeTextBox(l, maxWidth, maxHeight) : l));
              placeLayer(id, { x, y });
            }}
            onRotate={(id, angle) => updateLayer(id, (l) => rotateTo(l, angle))}
            onEditText={(id) => setEditText({ id })}
            preview={preview}
          />
          {assets.fontError && (
            <Alert tone="danger" data-testid="editor-error">
              {assets.fontError}
            </Alert>
          )}
          {assets.imageError !== null && <ErrorView error={assets.imageError} testId="image-load-error" />}
          {addImageError !== null && <ErrorView error={addImageError} testId="image-layer-error" />}
          {animated && (
            <Timeline
              media={media}
              frame={playback.frame}
              playing={playback.playing}
              selectedLayer={selectedLayer}
              layers={layers}
              onSeek={playback.seek}
              onTogglePlay={playback.toggle}
              onSelectLayer={select}
              onUpdateLayer={updateLayer}
            />
          )}
          {source.kind === "template" && <TemplateDetails template={source.template} preview={preview} onPreviewChange={setPreview} />}
        </div>
        <div className="editor-side">
          <LayerPanel
            nameable={authoring}
            media={media}
            layers={layers}
            selectedId={selectedId}
            frame={playback.frame}
            fonts={fonts}
            addingImage={addingImage}
            editText={editText}
            onSelect={select}
            onAddImage={(file) => void addImageFile(file)}
            onAddSticker={addSticker}
            onAdd={addLayer}
            onTopSection={list.setTopSection}
            onRemove={list.remove}
            onMoveOrder={list.move}
            onUpdate={updateLayer}
            onPlace={placeLayer}
            onSeek={playback.seek}
            onFontUploaded={fontUploaded}
          />
          {animated && <PreviewPanel media={media} layers={layers} images={assets.images} />}
          {source.kind === "new-template" ? (
            <TemplateSavePanel
              defaultName={nameFromFile(source.asset.filename)}
              what={boxes}
              note={`The ${boxes} (text with its placeholder, and images) become the template's defaults.`}
              ready
              create={(name, tags) => createTemplate({ name, assetId: source.asset.id, defaultLayers: layers, tags })}
              assetId={source.asset.id}
            />
          ) : source.kind === "edit-template" ? (
            <TemplateEditPanel
              template={source.template}
              initialContent={source.template.defaultLayers}
              content={layers}
              note={`The ${boxes} (text with its placeholder, and images) are the template's defaults. Memes already made from it keep their own layers.`}
              ready
              save={(name) => updateTemplate(source.template.id, { name, defaultLayers: layers })}
            />
          ) : (
            <SavePanel render={render} content={{ layers, panels: null }} limits={limits} {...memeSaveProps(source, user)} />
          )}
        </div>
      </section>
    </>
  );
}
