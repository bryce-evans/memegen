import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { decodeMedia, loadFont, type DecodedMedia } from "@memegen/render";
import {
  layerStateAt,
  newTextLayer,
  upsertKeyframe,
  type Asset,
  type Meme,
  type Template,
  type TextLayer,
  type UploadLimits,
} from "@memegen/shared";
import { Alert, PageHeader, Spinner } from "@memegen/ui";
import { fetchAssetBlob, fontUrl, getAsset, getLimits, getMeme, getTemplate, listFonts } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { LayerPanel } from "../components/editor/LayerPanel.tsx";
import { SavePanel } from "../components/editor/SavePanel.tsx";
import { TemplateSavePanel } from "../components/editor/TemplateSavePanel.tsx";
import { Stage } from "../components/editor/Stage.tsx";
import { Timeline } from "../components/editor/Timeline.tsx";
import { HotTemplates, NewTemplateForm, TemplateBrowser, TemplateDetails } from "../components/templates.tsx";

/** Where the media came from; decides how the meme is saved. */
type Source =
  | { kind: "template"; template: Template }
  /** Uploaded media becoming a new template ("Template Editor"); its text boxes become the defaults. */
  | { kind: "new-template"; asset: Asset }
  | { kind: "meme"; meme: Meme };

interface Session {
  source: Source;
  media: DecodedMedia;
  layers: TextLayer[];
}

function defaultFontId(fonts: Asset[]): string | null {
  return (fonts.find((f) => f.name.toLowerCase() === "impact") ?? fonts[0])?.id ?? null;
}

function defaultLayers(fontAssetId: string | null): TextLayer[] {
  return [
    newTextLayer({ text: "TOP TEXT", y: 0.1, fontAssetId }),
    newTextLayer({ text: "BOTTOM TEXT", y: 0.9, fontAssetId }),
  ];
}

/** Remount the editor whenever the query string changes (new template/meme/upload). */
export function Editor() {
  const location = useLocation();
  return <EditorLoader key={location.search} />;
}

function EditorLoader() {
  const [params] = useSearchParams();
  const templateId = params.get("template");
  const memeId = params.get("meme");
  const newTemplateAssetId = params.get("newTemplate");
  const [fonts, setFonts] = useState<Asset[] | null>(null);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef<DecodedMedia | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");

  const replaceMedia = useCallback((next: Session) => {
    mediaRef.current?.dispose();
    mediaRef.current = next.media;
    setSession(next);
  }, []);

  useEffect(() => () => mediaRef.current?.dispose(), []);

  // Fonts + limits first (new layers need the default font), then the source media.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [fontPage, uploadLimits] = await Promise.all([listFonts(), getLimits()]);
      if (cancelled) return;
      setFonts(fontPage.items);
      setLimits(uploadLimits);
      const fontId = defaultFontId(fontPage.items);

      let source: Source;
      let asset: Asset;
      let layers: TextLayer[];
      if (memeId) {
        const meme = await getMeme(memeId);
        source = { kind: "meme", meme };
        asset = meme.sourceAsset;
        layers = meme.layers;
      } else if (templateId) {
        const template = await getTemplate(templateId);
        source = { kind: "template", template };
        asset = template.asset;
        layers = template.defaultLayers.length
          ? template.defaultLayers.map((l) => ({ ...structuredClone(l), id: crypto.randomUUID() }))
          : defaultLayers(fontId);
      } else if (newTemplateAssetId) {
        asset = await getAsset(newTemplateAssetId);
        source = { kind: "new-template", asset };
        layers = defaultLayers(fontId);
      } else {
        return;
      }
      if (asset.kind === "font") throw new Error("source asset is a font, not media");
      if (cancelled) return;
      setBusy(true);
      const blob = await fetchAssetBlob(asset);
      const media = await decodeMedia(blob, asset.kind);
      if (cancelled) {
        media.dispose();
        return;
      }
      replaceMedia({ source, media, layers });
    })()
      .catch((err: unknown) => !cancelled && setError(err))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [memeId, templateId, newTemplateAssetId, replaceMedia]);

  if (session && fonts && limits) {
    return <Workspace session={session} fonts={fonts} limits={limits} onFontsChange={setFonts} />;
  }

  const starting = !memeId && !templateId && !newTemplateAssetId;
  return (
    <section className="editor-start">
      <PageHeader title={memeId ? "Edit meme" : newTemplateAssetId ? "Template Editor" : templateId ? "Loading template" : "Create a meme"} />
      {starting && (
        <div className="create-top">
          <HotTemplates />
          <div className="create-upload">
            <NewTemplateForm limits={limits} />
          </div>
        </div>
      )}
      {(busy || (fonts === null && error === null)) && <Spinner label="Loading…" />}
      {error !== null && <ErrorView error={error} testId="editor-error" />}
      {starting && <TemplateBrowser search={templateSearch} onSearchChange={setTemplateSearch} />}
    </section>
  );
}

interface WorkspaceProps {
  session: Session;
  fonts: Asset[];
  limits: UploadLimits;
  onFontsChange: (fonts: Asset[]) => void;
}

function Workspace({ session, fonts, limits, onFontsChange }: WorkspaceProps) {
  const { media, source } = session;
  const { user } = useAuth();
  const [layers, setLayers] = useState<TextLayer[]>(session.layers);
  const [selectedId, setSelectedId] = useState<string | null>(session.layers[0]?.id ?? null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fontsVersion, setFontsVersion] = useState(0);
  const [fontError, setFontError] = useState<string | null>(null);
  const animated = media.kind !== "image";
  const t = media.times[frame] ?? 0;
  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
  const isOwnMeme = source.kind !== "meme" || source.meme.owner.id === user?.id;

  // Load every referenced font; redraw (re-measure) once each is ready.
  const fontKey = [...new Set(layers.map((l) => l.fontAssetId).filter((id): id is string => id !== null))].sort().join(",");
  useEffect(() => {
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

  const updateLayer = useCallback((id: string, patch: Partial<TextLayer>) => {
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  /** Static layers move their anchor; animated layers get a keyframe at the current frame. */
  const placeLayer = useCallback(
    (id: string, next: { x?: number; y?: number; opacity?: number }) => {
      setLayers((ls) =>
        ls.map((l) => {
          if (l.id !== id) return l;
          if (l.keyframes.length === 0) return { ...l, ...next };
          const state = layerStateAt(l, t);
          return {
            ...l,
            keyframes: upsertKeyframe(l.keyframes, {
              t,
              x: next.x ?? state.x,
              y: next.y ?? state.y,
              opacity: next.opacity ?? state.opacity,
            }),
          };
        }),
      );
    },
    [t],
  );

  const seek = useCallback((f: number) => {
    setPlaying(false);
    setFrame(f);
  }, []);

  return (
    <>
      {source.kind === "new-template" && <PageHeader title="Template Editor" titleProps={{ "data-testid": "editor-title" }} />}
      <section className="editor">
      <div className="editor-main">
        <Stage
          media={media}
          layers={layers}
          frame={frame}
          selectedId={selectedId}
          fontsVersion={fontsVersion}
          onSelect={setSelectedId}
          onMove={(id, x, y) => placeLayer(id, { x, y })}
        />
        {fontError && (
          <Alert tone="error" data-testid="editor-error">
            {fontError}
          </Alert>
        )}
        {animated && (
          <Timeline
            media={media}
            frame={frame}
            playing={playing}
            selectedLayer={selectedLayer}
            onSeek={seek}
            onTogglePlay={() => setPlaying((p) => !p)}
          />
        )}
        {source.kind === "template" && <TemplateDetails template={source.template} />}
      </div>
      <div className="editor-side">
        <LayerPanel
          media={media}
          layers={layers}
          selectedId={selectedId}
          frame={frame}
          fonts={fonts}
          onSelect={setSelectedId}
          onAdd={() => {
            const layer = newTextLayer({ text: "TEXT", y: 0.5, fontAssetId: defaultFontId(fonts) });
            setLayers((ls) => [...ls, layer]);
            setSelectedId(layer.id);
          }}
          onRemove={(id) => {
            setLayers((ls) => ls.filter((l) => l.id !== id));
            if (selectedId === id) setSelectedId(null);
          }}
          onMoveOrder={(id, delta) =>
            setLayers((ls) => {
              const i = ls.findIndex((l) => l.id === id);
              const j = i + delta;
              if (i < 0 || j < 0 || j >= ls.length) return ls;
              const next = [...ls];
              [next[i], next[j]] = [next[j]!, next[i]!];
              return next;
            })
          }
          onUpdate={updateLayer}
          onPlace={placeLayer}
          onSeek={seek}
          onFontUploaded={async (font) => {
            try {
              onFontsChange((await listFonts()).items);
            } catch {
              onFontsChange([...fonts, font]);
            }
            if (selectedId) updateLayer(selectedId, { fontAssetId: font.id });
          }}
        />
        {source.kind === "new-template" ? (
          <TemplateSavePanel asset={source.asset} layers={layers} />
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
