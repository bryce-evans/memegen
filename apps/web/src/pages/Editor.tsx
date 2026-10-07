import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { layerFontIds, loadFont } from "@memegen/render";
import { newTextLayer, placeAt, type Asset, type TextLayer } from "@memegen/shared";
import { Alert, PageHeader, Spinner } from "@memegen/ui";
import { fontUrl, listFonts } from "../api.ts";
import { useUser } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { CreateStart } from "../components/editor/CreateStart.tsx";
import { LayerPanel } from "../components/editor/LayerPanel.tsx";
import { PreviewPanel } from "../components/editor/PreviewPanel.tsx";
import { SavePanel } from "../components/editor/SavePanel.tsx";
import { defaultFontId, sourceRef, useEditorSession, type Session, type SourceRef } from "../components/editor/session.ts";
import { Stage } from "../components/editor/Stage.tsx";
import { TemplateEditPanel } from "../components/editor/TemplateEditPanel.tsx";
import { TemplateSavePanel } from "../components/editor/TemplateSavePanel.tsx";
import { Timeline } from "../components/editor/Timeline.tsx";
import { TemplateDetails } from "../components/templateDetails.tsx";

const LOADING_TITLES: Record<SourceRef["kind"], string> = {
  meme: "Edit meme",
  template: "Loading template",
  "new-template": "Template Editor",
  "edit-template": "Edit template",
};

/** `/create`: the start page, or the editor for `?meme=` / `?template=` / `?newTemplate=` / `?editTemplate=`. */
export function Editor() {
  const location = useLocation();
  const [params] = useSearchParams();
  const ref = sourceRef(params);
  // Remount whenever the query string changes (new template/meme/upload).
  return ref ? <EditorSession key={location.search} source={ref} /> : <CreateStart />;
}

function EditorSession({ source }: { source: SourceRef }) {
  const { session, error } = useEditorSession(source);
  if (session) return <Workspace session={session} />;
  return (
    <section className="editor-start">
      <PageHeader title={LOADING_TITLES[source.kind]} />
      {error === null ? <Spinner label="Loading…" /> : <ErrorView error={error} testId="editor-error" />}
    </section>
  );
}

function Workspace({ session }: { session: Session }) {
  const { media, source, limits } = session;
  const user = useUser();
  const [fonts, setFonts] = useState<Asset[]>(session.fonts);
  const [layers, setLayers] = useState<TextLayer[]>(session.layers);
  const [selectedId, setSelectedId] = useState<string | null>(session.layers[0]?.id ?? null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fontsVersion, setFontsVersion] = useState(0);
  const [fontError, setFontError] = useState<string | null>(null);
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
      loadFont(id, fontUrl(id)).then(
        () => !cancelled && setFontsVersion((v) => v + 1),
        (err: unknown) => !cancelled && setFontError(`font failed to load: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [fontKey]);

  // Playback: advance by each frame's own duration.
  useEffect(() => {
    if (!playing || !animated) return;
    const ms = Math.max(10, (media.durations[frame] ?? 0.1) * 1000);
    const timer = setTimeout(() => setFrame((f) => (f + 1) % media.times.length), ms);
    return () => clearTimeout(timer);
  }, [playing, animated, frame, media]);

  const updateLayer = useCallback((id: string, update: (layer: TextLayer) => TextLayer) => {
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
    updateLayer(layerId, (l) => ({ ...l, fontAssetId: font.id }));
  }

  return (
    <>
      {source.kind === "new-template" && <PageHeader title="Template Editor" titleProps={{ "data-testid": "editor-title" }} />}
      {source.kind === "edit-template" && <PageHeader title="Edit template" titleProps={{ "data-testid": "editor-title" }} />}
      <section className="editor">
        <div className="editor-main">
          <Stage
            media={media}
            layers={layers}
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
            onSelect={setSelectedId}
            onAdd={addLayer}
            onRemove={removeLayer}
            onMoveOrder={moveLayer}
            onUpdate={updateLayer}
            onSeek={seek}
            onFontUploaded={fontUploaded}
          />
          {animated && <PreviewPanel media={media} layers={layers} />}
          {source.kind === "new-template" ? (
            <TemplateSavePanel asset={source.asset} layers={layers} />
          ) : source.kind === "edit-template" ? (
            <TemplateEditPanel template={source.template} layers={layers} canEdit={source.template.owner.id === user.id} />
          ) : (
            <SavePanel
              media={media}
              layers={layers}
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
