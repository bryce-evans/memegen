import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ensureLayerFonts, ensureLayerImages, exportMeme, layerFontIds, layerImageIds, loadFont, loadLayerImage, type LayerImages } from "@memegen/render";
import { LAYER_NAME_MAX_LENGTH, newImageLayer, newTextLayer, placeAt, stillExportSize, type Asset, type Layer, type Sticker } from "@memegen/shared";
import { Alert, PageHeader, Spinner } from "@memegen/ui";
import { assetUrl, createTemplate, listFonts, updateTemplate, uploadAsset } from "../api.ts";
import { useUser } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { CreateStart } from "../components/editor/CreateStart.tsx";
import { LayerPanel } from "../components/editor/LayerPanel.tsx";
import { PanelWorkspace } from "../components/editor/PanelWorkspace.tsx";
import { PreviewPanel } from "../components/editor/PreviewPanel.tsx";
import { SavePanel, type RenderProgress } from "../components/editor/SavePanel.tsx";
import { defaultFontId, sourceRef, useEditorSession, type MediaSession, type SourceRef } from "../components/editor/session.ts";
import { Stage } from "../components/editor/Stage.tsx";
import { TemplateEditPanel } from "../components/editor/TemplateEditPanel.tsx";
import { nameFromFile, TemplateSavePanel } from "../components/editor/TemplateSavePanel.tsx";
import { Timeline } from "../components/editor/Timeline.tsx";
import { TemplateDetails } from "../components/templateDetails.tsx";
import { plural } from "../format.ts";
import { precheckMedia } from "../media.ts";

const LOADING_TITLES: Record<SourceRef["kind"], string> = {
  meme: "Edit meme",
  template: "Loading template",
  "new-template": "Template Editor",
  "edit-template": "Edit template",
  "new-panels": "Multi-panel Template Editor",
};

/**
 * `/create`: the start page, or the editor for `?meme=` / `?template=` / `?newTemplate=` / `?editTemplate=` /
 * `?newPanels`. Multi-panel templates (and memes made from them) open the panel editor.
 */
export function Editor() {
  const location = useLocation();
  const [params] = useSearchParams();
  const ref = sourceRef(params);
  // Remount whenever the query string changes (new template/meme/upload).
  return ref ? <EditorSession key={location.search} source={ref} /> : <CreateStart />;
}

function EditorSession({ source }: { source: SourceRef }) {
  const { session, error } = useEditorSession(source);
  if (session) return session.type === "panels" ? <PanelWorkspace session={session} /> : <Workspace session={session} />;
  return (
    <section className="editor-start">
      <PageHeader title={LOADING_TITLES[source.kind]} />
      {error === null ? <Spinner label="Loading…" /> : <ErrorView error={error} testId="editor-error" />}
    </section>
  );
}

function Workspace({ session }: { session: MediaSession }) {
  const { media, source, limits } = session;
  const user = useUser();
  const [fonts, setFonts] = useState<Asset[]>(session.fonts);
  const [layers, setLayers] = useState<Layer[]>(session.layers);
  const [selectedId, setSelectedId] = useState<string | null>(session.layers[0]?.id ?? null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fontsVersion, setFontsVersion] = useState(0);
  const [fontError, setFontError] = useState<string | null>(null);
  const [layerImages, setLayerImages] = useState<LayerImages>(() => new Map());
  const [addingImage, setAddingImage] = useState(false);
  const [imageError, setImageError] = useState<unknown>(null);
  const animated = media.kind !== "image";
  const t = media.times[frame] ?? 0;
  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
  const isOwnMeme = source.kind !== "meme" || source.meme.owner.id === user.id;

  // Load every referenced font; redraw (re-measure) once each is ready.
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

  // Decode every referenced image (cached per asset); redraw once they are all ready.
  const imageKey = layerImageIds(layers).sort().join(",");
  useEffect(() => {
    const ids = imageKey ? imageKey.split(",") : [];
    let cancelled = false;
    Promise.all(ids.map((id) => loadLayerImage(id, assetUrl(id)))).then(
      (images) => !cancelled && setLayerImages(new Map(ids.map((id, i) => [id, images[i]!]))),
      (err: unknown) => !cancelled && setImageError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  // Playback: advance by each frame's own duration.
  useEffect(() => {
    if (!playing || !animated) return;
    const ms = Math.max(10, (media.durations[frame] ?? 0.1) * 1000);
    const timer = setTimeout(() => setFrame((f) => (f + 1) % media.times.length), ms);
    return () => clearTimeout(timer);
  }, [playing, animated, frame, media]);

  const updateLayer = useCallback((id: string, update: (layer: Layer) => Layer) => {
    setLayers((ls) => ls.map((l) => (l.id === id ? update(l) : l)));
  }, []);

  const seek = useCallback((f: number) => {
    setPlaying(false);
    setFrame(f);
  }, []);

  function addLayer() {
    const layer = newTextLayer({ name: `Text ${layers.length + 1}`, text: "TEXT", y: 0.5, fontAssetId: defaultFontId(fonts) });
    setLayers((ls) => [...ls, layer]);
    setSelectedId(layer.id);
  }

  /** Add a stored still image centered, at its native width relative to the media but at most half the media's width. */
  function addImageLayer(assetId: string, pixelWidth: number, name: string) {
    const layer = newImageLayer(assetId, { name: name.slice(0, LAYER_NAME_MAX_LENGTH), width: Math.min(0.5, pixelWidth / media.width) });
    setLayers((ls) => [...ls, layer]);
    setSelectedId(layer.id);
  }

  /** Check `file` against the image caps, upload it, and add it as an image layer. */
  async function addImageFile(file: File) {
    setImageError(null);
    setAddingImage(true);
    try {
      const checked = await precheckMedia(file, limits);
      const { kind, width } = checked;
      checked.dispose();
      if (kind !== "image") throw new Error("image layers must be still images (PNG, JPEG, or WebP)");
      const asset = await uploadAsset(file, file.name || "pasted.png");
      addImageLayer(asset.id, width, `Image ${layers.length + 1}`);
    } catch (err) {
      setImageError(err);
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

  function removeLayer(id: string) {
    setLayers((ls) => ls.filter((l) => l.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function moveLayer(id: string, delta: -1 | 1) {
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

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
    return exportMeme(media, layers, images, {
      signal,
      onProgress: (value) => progress("Rendering", value),
      stillSize: stillExportSize(media.width, media.height, limits),
    });
  }

  const boxes = plural(layers.length, "layer", "layers");
  return (
    <>
      {source.kind === "new-template" && <PageHeader title="Template Editor" titleProps={{ "data-testid": "editor-title" }} />}
      {source.kind === "edit-template" && <PageHeader title="Edit template" titleProps={{ "data-testid": "editor-title" }} />}
      <section className="editor">
        <div className="editor-main">
          <Stage
            media={media}
            layers={layers}
            images={layerImages}
            frame={frame}
            selectedId={selectedId}
            fontsVersion={fontsVersion}
            onSelect={setSelectedId}
            onMove={(id, x, y) => updateLayer(id, (l) => placeAt(l, t, { x, y }))}
          />
          {fontError && (
            <Alert tone="danger" data-testid="editor-error">
              {fontError}
            </Alert>
          )}
          {imageError !== null && <ErrorView error={imageError} testId="image-layer-error" />}
          {animated && (
            <Timeline
              media={media}
              frame={frame}
              playing={playing}
              selectedLayer={selectedLayer}
              layers={layers}
              onSeek={seek}
              onTogglePlay={() => setPlaying((p) => !p)}
              onSelectLayer={setSelectedId}
              onUpdateLayer={updateLayer}
            />
          )}
          {source.kind === "template" && <TemplateDetails template={source.template} />}
        </div>
        <div className="editor-side">
          <LayerPanel
            nameable={source.kind === "new-template" || source.kind === "edit-template"}
            media={media}
            layers={layers}
            selectedId={selectedId}
            frame={frame}
            fonts={fonts}
            addingImage={addingImage}
            onSelect={setSelectedId}
            onAddImage={(file) => void addImageFile(file)}
            onAddSticker={addSticker}
            onAdd={addLayer}
            onRemove={removeLayer}
            onMoveOrder={moveLayer}
            onUpdate={updateLayer}
            onSeek={seek}
            onFontUploaded={fontUploaded}
          />
          {animated && <PreviewPanel media={media} layers={layers} images={layerImages} />}
          {source.kind === "new-template" ? (
            <TemplateSavePanel
              defaultName={nameFromFile(source.asset.filename)}
              what={boxes}
              note={`The ${boxes} (text with its placeholder, and images) become the template's defaults.`}
              ready
              create={(name, tags) => createTemplate({ name, assetId: source.asset.id, defaultLayers: layers, tags })}
            />
          ) : source.kind === "edit-template" ? (
            <TemplateEditPanel
              template={source.template}
              canEdit={source.template.owner.id === user.id}
              initialContent={source.template.defaultLayers}
              content={layers}
              note={`The ${boxes} (text with its placeholder, and images) are the template's defaults. Memes already made from it keep their own layers.`}
              ready
              save={(name) => updateTemplate(source.template.id, { name, defaultLayers: layers })}
            />
          ) : (
            <SavePanel
              render={render}
              content={{ layers, panels: null }}
              limits={limits}
              canSave={isOwnMeme}
              target={source.kind === "meme" ? { editing: source.meme } : { templateId: source.template.id }}
              defaultTitle={source.kind === "template" ? source.template.name : ""}
              suggestedTags={source.kind === "template" ? source.template.tags : []}
            />
          )}
        </div>
      </section>
    </>
  );
}
