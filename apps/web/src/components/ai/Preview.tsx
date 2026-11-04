import { useEffect, useMemo, useRef, useState } from "react";
import { composedSize, composeFrame, composePanels, context2d, decodeMedia, ensureLayerFonts, ensureLayerImages, loadAssetImages, panelSetGrid, type DecodedMedia } from "@memegen/render";
import { panelGrid, type Template } from "@memegen/shared";
import { assetUrl, fetchAssetBlob, listFonts } from "../../api.ts";
import { defaultFontId } from "../../memeDraft.ts";
import { useAsync } from "../../useAsync.ts";
import { ErrorView } from "../common.tsx";
import { useCanvasScale } from "../editor/useCanvasScale.ts";
import { initialDraft, type CreatorDraft } from "./draft.ts";

/** Own decoded source media independently of captions, fonts and canvas size. Pack images use render's page cache. */
export function TemplateCanvas({ template, draft, onOpen }: { template: Template; draft: CreatorDraft | null; onOpen: (() => void) | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<unknown>(null);
  const fonts = useAsync("creator-preview-fonts", listFonts);
  const current = useMemo(() => draft ?? initialDraft(template, defaultFontId(fonts.data?.items ?? [])), [draft, template, fonts.data]);
  const blob = current.kind === "media" ? current.image?.blob : undefined;
  const source = blob ?? template.asset;
  const isPanels = current.kind === "panels";
  const [loaded, setLoaded] = useState<{ source: typeof source; media: DecodedMedia; frame: CanvasImageSource } | null>(null);
  const size = current.kind === "panels"
    ? panelGrid(current.panels.layout, current.panels.mirror, current.panels.panels.map((panel) => {
      const asset = template.panels!.pack.find((asset) => asset.id === panel.assetId)!;
      return asset.height! / asset.width!;
    }))
    : composedSize(current.layers, loaded?.source === source ? loaded.media : { width: template.asset.width!, height: template.asset.height! }, 800);
  const { pixelWidth, displayWidth } = useCanvasScale(canvasRef, 800, true, size.width / size.height);
  useEffect(() => {
    setLoaded(null);
    setError(null);
    if (isPanels) return;
    let cancelled = false;
    let owned: DecodedMedia | null = null;
    const abort = new AbortController();
    (async () => {
      const kind = blob ? "image" : template.asset.kind;
      if (kind === "font") throw new Error("template asset is a font, not media");
      const media = await decodeMedia(blob ?? await fetchAssetBlob(template.asset, abort.signal), kind);
      if (cancelled) return media.dispose();
      // Acquire ownership immediately, before any independent request or frame operation can fail.
      owned = media;
      const frame = await media.frame(0);
      if (!cancelled) setLoaded({ source, media, frame });
    })().catch((err: unknown) => {
      owned?.dispose();
      owned = null;
      if (!cancelled) setError(err);
    });
    return () => {
      cancelled = true;
      abort.abort();
      owned?.dispose();
      owned = null;
    };
  }, [source, isPanels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.ready = "false";
    let cancelled = false;
    (async () => {
      if (current.kind === "panels") {
        const images = await loadAssetImages(template.panels!.pack.map((asset) => asset.id), assetUrl);
        if (cancelled) return;
        const grid = panelSetGrid(current.panels, images);
        canvas.width = pixelWidth;
        canvas.height = Math.max(1, Math.round(pixelWidth * grid.height / grid.width));
        composePanels(context2d(canvas), current.panels, images, canvas.width, canvas.height);
      } else {
        if (!loaded || loaded.source !== source || !fonts.data) return;
        const [, images] = await Promise.all([ensureLayerFonts(current.layers, assetUrl), ensureLayerImages(current.layers, assetUrl)]);
        if (cancelled) return;
        const size = composedSize(current.layers, loaded.media, pixelWidth);
        canvas.width = size.width;
        canvas.height = size.height;
        composeFrame(context2d(canvas), loaded.frame, current.layers, images, canvas.width, canvas.height, 0);
      }
      canvas.dataset.updates = String(current.updates);
      canvas.dataset.ready = "true";
      setError(null);
    })().catch((err: unknown) => !cancelled && setError(err));
    return () => { cancelled = true; };
  }, [current, loaded, source, template, fonts.data, pixelWidth]);

  return <>
    <canvas
      ref={canvasRef}
      className="ai-creator-canvas"
      role="link"
      tabIndex={0}
      aria-disabled={onOpen === null || undefined}
      aria-label={`${template.name}${draft ? " as updated" : " with its default text"}: open in the full editor`}
      title="Open in the full editor"
      onClick={() => onOpen?.()}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onOpen?.();
      }}
      style={{ width: displayWidth || undefined }}
      data-testid="ai-canvas"
      data-template-id={template.id}
    />
    {(error ?? (!isPanels ? fonts.error : null)) !== null && <ErrorView error={error ?? fonts.error} />}
  </>;
}
