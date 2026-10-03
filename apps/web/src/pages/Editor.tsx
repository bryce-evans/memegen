import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { decodeMedia, loadFont, type DecodedMedia } from "@memegen/render";
import {
  layerStateAt,
  newTextLayer,
  upsertKeyframe,
  type Asset,
  type Meme,
  type TextLayer,
  type UploadLimits,
} from "@memegen/shared";
import { Alert, EmptyState, FileButton, Icon, Inline, LinkButton, PageHeader, Panel, Spinner } from "@memegen/ui";
import { fetchAssetBlob, fontUrl, getLimits, getMeme, getTemplate, listFonts, uploadAsset } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ErrorView } from "../components/common.tsx";
import { LayerPanel } from "../components/editor/LayerPanel.tsx";
import { SavePanel } from "../components/editor/SavePanel.tsx";
import { Stage } from "../components/editor/Stage.tsx";
import { Timeline } from "../components/editor/Timeline.tsx";
import { MEDIA_ACCEPT, precheckMedia } from "../media.ts";

/** Where the media came from; decides how the meme is saved. */
type Source =
  | { kind: "template"; templateId: string; asset: Asset; name: string; tags: string[] }
  | { kind: "meme"; meme: Meme }
  | { kind: "upload"; file: File };

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
  const [fonts, setFonts] = useState<Asset[] | null>(null);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef<DecodedMedia | null>(null);

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
        source = { kind: "template", templateId: template.id, asset: template.asset, name: template.name, tags: template.tags };
        asset = template.asset;
        layers = template.defaultLayers.length
          ? template.defaultLayers.map((l) => ({ ...structuredClone(l), id: crypto.randomUUID() }))
          : defaultLayers(fontId);
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
  }, [memeId, templateId, replaceMedia]);

  async function pickFile(file: File) {
    if (!limits || !fonts) return;
    setBusy(true);
    setError(null);
    try {
      const media = await precheckMedia(file, limits);
      replaceMedia({ source: { kind: "upload", file }, media, layers: defaultLayers(defaultFontId(fonts)) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (session && fonts && limits) {
    return <Workspace session={session} fonts={fonts} limits={limits} onFontsChange={setFonts} />;
  }

  return (
    <section className="editor-start">
      <PageHeader title={memeId ? "Edit meme" : templateId ? "Loading template" : "Create a meme"} />
      {!memeId && !templateId && (
        <Panel className="dropzone">
          <EmptyState
            icon={<Icon name="upload" />}
            title="Upload an image, GIF, MP4 or MOV — or pick one from the templates."
            description={
              limits && (
                <>
                  Max {(limits.maxBytes / 1024 / 1024).toFixed(0)} MB · images ≤ {limits.image.maxDimension}px · GIFs ≤{" "}
                  {limits.gif.maxDimension}px / {limits.gif.maxFrames} frames · videos ≤ {limits.video.maxDimension}px /{" "}
                  {limits.video.maxFrames} frames
                </>
              )
            }
            action={
              <Inline justify="center">
                <FileButton
                  variant="primary"
                  icon={<Icon name="upload" />}
                  data-testid="media-upload"
                  accept={MEDIA_ACCEPT}
                  disabled={busy || !limits}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void pickFile(file);
                  }}
                >
                  Choose media
                </FileButton>
                <LinkButton as={Link} to="/templates" icon={<Icon name="image" />}>
                  Browse templates
                </LinkButton>
              </Inline>
            }
          />
        </Panel>
      )}
      {(busy || (fonts === null && error === null)) && <Spinner label="Loading…" />}
      {error !== null && <ErrorView error={error} testId="editor-error" />}
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
  const uploadedSource = useRef<Promise<Asset> | null>(null);
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

  const getSourceAssetId = useCallback(
    async (signal?: AbortSignal) => {
      if (source.kind === "template") return source.asset.id;
      if (source.kind === "meme") return source.meme.sourceAsset.id;
      // Upload the local file once, on first save; retry after failures.
      uploadedSource.current ??= uploadAsset(source.file, source.file.name, undefined, signal);
      try {
        return (await uploadedSource.current).id;
      } catch (err) {
        uploadedSource.current = null;
        throw err;
      }
    },
    [source],
  );

  return (
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
        <SavePanel
          media={media}
          layers={layers}
          limits={limits}
          canSave={isOwnMeme}
          editingMeme={source.kind === "meme" ? source.meme : null}
          templateId={source.kind === "template" ? source.templateId : null}
          defaultTitle={source.kind === "template" ? source.name : ""}
          suggestedTags={source.kind === "template" ? source.tags : []}
          getSourceAssetId={getSourceAssetId}
        />
      </div>
    </section>
  );
}
