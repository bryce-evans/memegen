import { useEffect, useRef, useState } from "react";
import { exportPanels, panelSetGrid } from "@memegen/render";
import { MAX_PANELS, newPanel, panelExportSize, type Asset, type Panel, type PanelSet } from "@memegen/shared";
import { PageHeader } from "@memegen/ui";
import { createTemplate, updateTemplate, uploadAsset, type PanelTemplateInput } from "../../api.ts";
import { useUser } from "../../auth.tsx";
import { plural } from "../../format.ts";
import { fileSlug } from "../../media.ts";
import { TemplateDetails } from "../templateDetails.tsx";
import { PackPanel } from "./PackPanel.tsx";
import { PanelList } from "./PanelList.tsx";
import { PanelStage } from "./PanelStage.tsx";
import { SavePanel } from "./SavePanel.tsx";
import { decodePackImage, type PanelSession } from "./session.ts";
import { TemplateEditPanel } from "./TemplateEditPanel.tsx";
import { TemplateSavePanel } from "./TemplateSavePanel.tsx";

/** What a template stores for `set` with `pack`; also compared to detect unsaved template edits. */
function templateInputOf(set: PanelSet, pack: Asset[]): PanelTemplateInput {
  return { layout: set.layout, grid: set.grid, fontSize: set.fontSize, packAssetIds: pack.map((a) => a.id), defaultPanels: set.panels };
}

/**
 * The multi-panel editor: pick a layout, grid, and caption size, add panels, and give each one a pack image and a
 * caption. Authoring a template (`?newPanels`, `?editTemplate=`) also manages the image pack; its setup becomes the
 * defaults.
 */
export function PanelWorkspace({ session }: { session: PanelSession }) {
  const { source, limits } = session;
  const user = useUser();
  const [set, setSet] = useState<PanelSet>(session.set);
  const [pack, setPack] = useState<Asset[]>(session.pack);
  const [images, setImages] = useState(session.images);
  const [selectedId, setSelectedId] = useState<string | null>(session.set.panels[0]?.id ?? null);
  const panels = set.panels;
  const setPanels = (update: (ps: Panel[]) => Panel[]) => setSet((s) => ({ ...s, panels: update(s.panels) }));
  // Images decoded here (new uploads) are closed on leaving; the session closes the ones it loaded.
  const decoded = useRef<ImageBitmap[]>([]);
  useEffect(
    () => () => {
      for (const image of decoded.current) image.close();
    },
    [],
  );

  const authoring = source.kind === "new-panels" || source.kind === "edit-template";
  const storedPack = source.kind === "edit-template" ? (source.template.panels?.pack ?? []) : [];
  const templateInput = templateInputOf(set, pack);
  const what = plural(panels.length, "panel", "panels");

  async function imagesAdded(assets: Asset[]) {
    const bitmaps = await Promise.all(assets.map((a) => decodePackImage(a)));
    decoded.current.push(...bitmaps);
    setImages((prev) => {
      const next = new Map(prev);
      assets.forEach((a, i) => next.set(a.id, bitmaps[i]!));
      return next;
    });
    setPack((p) => [...p, ...assets]);
    // A fresh template starts with one panel per image.
    if (panels.length === 0 && assets.length) {
      const start = assets.slice(0, MAX_PANELS).map((a) => newPanel(a.id));
      setPanels(() => start);
      setSelectedId(start[0]!.id);
    }
  }

  function addPanel() {
    const last = panels.at(-1);
    // Continue through the pack (expanding brain: each new panel shows the next image).
    const next = pack[last ? (pack.findIndex((a) => a.id === last.assetId) + 1) % pack.length : 0];
    if (!next) return;
    const panel = newPanel(next.id);
    setPanels((ps) => [...ps, panel]);
    setSelectedId(panel.id);
  }

  function movePanel(id: string, delta: -1 | 1) {
    setPanels((ps) => {
      const i = ps.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ps.length) return ps;
      const next = [...ps];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function removePanel(id: string) {
    setPanels((ps) => ps.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  const render = () => exportPanels(set, images, panelExportSize(panelSetGrid(set, images), limits));

  /** The template's cover: its default panels, rendered and uploaded like a meme. */
  async function uploadCover(name: string): Promise<Asset> {
    const cover = await render();
    return uploadAsset(cover.blob, `${fileSlug(name)}${cover.extension}`);
  }

  const packNote = "The image pack, layout, grid, caption size, and panels with their images and captions";
  return (
    <>
      {source.kind === "new-panels" && <PageHeader title="Multi-panel Template Editor" titleProps={{ "data-testid": "editor-title" }} />}
      {source.kind === "edit-template" && <PageHeader title="Edit template" titleProps={{ "data-testid": "editor-title" }} />}
      <section className="editor">
        <div className="editor-main">
          <PanelStage set={set} images={images} selectedId={selectedId} onSelect={setSelectedId} />
          {source.kind === "template" && <TemplateDetails template={source.template} />}
        </div>
        <div className="editor-side">
          {authoring && (
            <PackPanel
              pack={pack}
              limits={limits}
              locked={(asset) =>
                storedPack.some((a) => a.id === asset.id)
                  ? "Saved pack images can't be removed"
                  : panels.some((p) => p.assetId === asset.id)
                    ? "A panel shows this image"
                    : null
              }
              onAdded={imagesAdded}
              onRemove={(asset) => setPack((p) => p.filter((a) => a.id !== asset.id))}
            />
          )}
          <PanelList
            heading={authoring ? "Default Setup" : "Panels"}
            layout={set.layout}
            grid={set.grid}
            fontSize={set.fontSize}
            panels={panels}
            pack={pack}
            selectedId={selectedId}
            onStyle={(changes) => setSet((s) => ({ ...s, ...changes }))}
            onSelect={setSelectedId}
            onAdd={addPanel}
            onRemove={removePanel}
            onMove={movePanel}
            onUpdate={(id, changes) => setPanels((ps) => ps.map((p) => (p.id === id ? { ...p, ...changes } : p)))}
          />
          {source.kind === "new-panels" ? (
            <TemplateSavePanel
              defaultName=""
              what={`${what} and ${plural(pack.length, "image", "images")}`}
              note={`${packNote} become the template's defaults.`}
              ready={panels.length > 0}
              create={async (name, tags) => {
                const cover = await uploadCover(name);
                return createTemplate({ name, assetId: cover.id, panels: templateInput, tags });
              }}
            />
          ) : source.kind === "edit-template" ? (
            <TemplateEditPanel
              template={source.template}
              canEdit={source.template.owner.id === user.id}
              initialContent={templateInputOf(session.set, session.pack)}
              content={templateInput}
              note={`${packNote} are the template's defaults. Saved pack images stay; memes already made from it keep their own panels.`}
              ready={panels.length > 0}
              save={async (name) => {
                const cover = await uploadCover(name);
                return updateTemplate(source.template.id, { name, panels: templateInput, assetId: cover.id });
              }}
            />
          ) : (
            <SavePanel
              render={async (_signal, progress) => {
                progress("Rendering", null);
                return render();
              }}
              content={{ layers: [], panels: set }}
              limits={limits}
              canSave={source.kind !== "meme" || source.meme.owner.id === user.id}
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
