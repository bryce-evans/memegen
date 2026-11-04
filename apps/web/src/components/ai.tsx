import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { decodeMedia, ensureLayerFonts, ensureLayerImages, exportMeme, exportPanels, loadAssetImages, panelSetGrid } from "@memegen/render";
import { extensionForMime, MAX_TAGS, MEME_TITLE_MAX_LENGTH, panelExportSize, TEXT_MAX_LENGTH, type Asset, type Template } from "@memegen/shared";
import { Button, Icon, Inline, Panel, Spinner, Stack, Text, TextArea, TextField } from "@memegen/ui";
import { assetUrl, countTemplates, createTemplate, fetchAssetBlob, getLimits, listFonts, listTemplates, uploadAsset } from "../api.ts";
import { useAiSettings } from "../aiSettings.ts";
import { useUser } from "../auth.tsx";
import { fileSlug, nameFromFile } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { ErrorView, MediaView } from "./common.tsx";
import { defaultFontId, type EditorDraft } from "../memeDraft.ts";
import { publishMeme } from "../publishMeme.ts";
import { draftTarget, initialDraft, updateDraft, type CreatorDraft, type DraftImage } from "./ai/draft.ts";
import { TemplateCanvas } from "./ai/Preview.tsx";
import { useTemplateSearchPlaceholder } from "./templates.tsx";


/** Template search results shown under the Creator's search field. */
const PICKER_LIMIT = 6;

/** One line of a box's text: line breaks would split it in the directions. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

/**
 * The Describe field's placeholder for a template: each text box's text after its label (the top section's first, as
 * its layer is), so the agent knows which box each part goes in. Templates without boxes get the editor's own defaults.
 */
function startingText(template: Template): string {
  return draftTarget(initialDraft(template, null))
    .boxes.map((b) => `${b.label}: ${oneLine(b.text)}`)
    .join("\n");
}

/** Every browsable template has an editable draft, including panel packs. */
async function randomTemplate(): Promise<Template | null> {
  const { count } = await countTemplates();
  if (!count) return null;
  return (await listTemplates({ offset: Math.floor(Math.random() * count), limit: 1 })).items[0] ?? null;
}


/** The Creator's actions: ask the agent, open the result in the editor, or post it. */
type Action = "update" | "editor" | "publish";

/**
 * Create page, top: a template (a random one to begin with) shown on a canvas, and directions for the meme (starting
 * as the template's own text). Update sends the directions to the user's Agent Provider as a `quick-creator/2`
 * request on the canvas's current state; its `ADD_TEXT` actions rewrite the text boxes (never their placement or
 * timing), and its `UPDATE_IMAGE`, only offered for single media with an Image Generator set, goes to that generator. The canvas then
 * shows the result, and another Update builds on it. Full editor opens the result (or the template as is) in the
 * editor; Publish renders and posts it with the user's title and the template's tags, once an Update made one. An edited image
 * is uploaded only then, becoming a new template like any new media.
 */
export function AiCreator() {
  const user = useUser();
  const navigate = useNavigate();
  const { settings } = useAiSettings(user.id);
  const agent = settings.text;
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<Template | null>(null);
  const [draft, setDraft] = useState<CreatorDraft | null>(null);
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  // The Describe field's placeholder for the chosen template: its boxes' own text, never sent as directions.
  const [initial, setInitial] = useState("");
  const [step, setStep] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const q = useDebounced(search.trim(), 300);
  const results = useAsync(`ai-templates:${q}`, () => (q ? listTemplates({ q, limit: PICKER_LIMIT }) : Promise.resolve(null)));
  const start = useAsync("ai-random-template", randomTemplate);
  const searchPlaceholder = useTemplateSearchPlaceholder();
  const create = useAction();
  const words = description.trim();
  // Update needs the Agent Provider and typed directions other than the placeholder's own text; Publish needs an
  // Update's result and a nonblank title; Full editor needs neither (the template opens as is).
  const canUpdate = source !== null && agent !== null && words !== "" && words !== initial.trim();

  // Set once the user searches or picks: the random starting template never replaces their choice.
  const touched = useRef(false);

  function choose(template: Template) {
    setSource(template);
    setDraft(null);
    setSearch(template.name);
    setDescription("");
    setInitial(startingText(template));
  }

  // Begin with the random template, unless the user got there first.
  const random = start.data;
  useEffect(() => {
    if (random && !touched.current) choose(random);
  }, [random]);


  /** Upload an edited image as new media, named after its prompt. */
  function uploadImage({ blob, prompt }: DraftImage, signal: AbortSignal): Promise<Asset> {
    setStep("Uploading…");
    return uploadAsset(blob, `${fileSlug(prompt)}${extensionForMime(blob.type) ?? ".png"}`, undefined, signal);
  }

  /** Continue the complete draft, including titles entered before the first Update. */
  async function openEditor(from: Template, current: CreatorDraft, signal: AbortSignal) {
    const handoff: EditorDraft = current.kind === "panels"
      ? { kind: "panels", panels: current.panels, title }
      : { kind: "media", layers: current.layers, title };
    const state = { draft: handoff };
    if (current.kind === "panels" || !current.image) return navigate(`/create?template=${from.id}`, { state });
    const asset = await uploadImage(current.image, signal);
    if (!signal.aborted) navigate(`/create?newTemplate=${asset.id}`, { state });
  }

  /**
   * Render the draft with the export's own pipeline and post it with the user's title and the template's tags. An edited image
   * is saved as a new template first (as the Template Editor would, with the draft's boxes as its defaults).
   */
  async function publish(from: Template, current: CreatorDraft, signal: AbortSignal): Promise<string> {
    const limits = await getLimits();
    let template = from;
    let out;
    setStep("Rendering…");
    if (current.kind === "panels") {
      const images = await loadAssetImages(from.panels!.pack.map((asset) => asset.id), assetUrl);
      out = await exportPanels(current.panels, images, panelExportSize(panelSetGrid(current.panels, images), limits));
    } else {
      const { layers, image } = current;
      if (image) {
        const uploaded = await uploadImage(image, signal);
        template = await createTemplate({ name: nameFromFile(uploaded.filename), assetId: uploaded.id, defaultLayers: layers, tags: from.tags });
      }
      const { asset } = template;
      if (asset.kind === "font") throw new Error("template asset is a font, not media");
      const media = await decodeMedia(image?.blob ?? (await fetchAssetBlob(asset, signal)), asset.kind);
      try {
        const [, images] = await Promise.all([ensureLayerFonts(layers, assetUrl), ensureLayerImages(layers, assetUrl)]);
        out = await exportMeme(media, layers, images, limits, { signal });
      } finally {
        media.dispose();
      }
    }
    const meme = await publishMeme({
      output: out,
      content: current.kind === "panels" ? { layers: [], panels: current.panels } : { layers: current.layers, panels: null },
      target: { templateId: template.id }, title, visibility: "public", post: true,
      tags: template.tags.slice(0, MAX_TAGS), limits, signal, progress: setStep,
    });
    return meme.id;
  }

  function run(to: Action) {
    if (!source || (to === "publish" && !title.trim())) return;
    const from = source;
    const edited = draft;
    setAction(to);
    setStep("Working…");
    void create.run(async (signal) => {
      const current = edited ?? initialDraft(from, from.kind === "multi" ? null : defaultFontId((await listFonts()).items));
      if (to === "update") {
        const next = await updateDraft(from, current, words, settings, signal, setStep);
        if (!signal.aborted) setDraft(next);
      } else if (to === "editor") {
        await openEditor(from, current, signal);
      } else if (edited) {
        const memeId = await publish(from, current, signal);
        if (!signal.aborted) navigate(`/m/${memeId}`);
      }
    });
  }

  /** The running action's button shows its step. */
  const label = (of: Action, idle: string) => (create.busy && action === of ? step : idle);

  return (
    <Panel heading="Quick Creator" className="ai-creator" data-testid="ai-creator">
      <div className="ai-creator-body">
        <div className="ai-creator-preview">
          {source ? (
            <TemplateCanvas template={source} draft={draft} onOpen={create.busy ? null : () => run("editor")} />
          ) : start.error !== null ? (
            <ErrorView error={start.error} />
          ) : start.loading ? (
            <Spinner label="Picking a template…" />
          ) : (
            <Text tone="muted">{start.data ? "Pick a template." : "No templates yet."}</Text>
          )}
        </div>
        <Stack className="ai-creator-form">
          <TextField
            type="search"
            label="Template"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => {
              touched.current = true;
              setSearch(e.target.value);
            }}
            data-testid="ai-template-search"
          />
          {/* Always rendered, one result row tall, so results arriving or clearing never move the form below. */}
          <div className="ai-template-results" data-testid="ai-template-results">
            {results.error !== null && <ErrorView error={results.error} />}
            {results.data && results.data.items.length === 0 && (
              <Text size="sm" tone="muted">
                No templates match “{q}”.
              </Text>
            )}
            {results.data && results.data.items.length > 0 && (
              <div className="ai-template-options">
                {results.data.items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="ai-template-option"
                    title={`Use “${t.name}”`}
                    aria-pressed={t.id === source?.id}
                    onClick={() => choose(t)}
                    disabled={create.busy}
                    data-testid="ai-template-option"
                    data-template-id={t.id}
                  >
                    <MediaView asset={t.asset} alt={t.name} />
                    <span className="ai-template-option-name">{t.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <TextArea
            label={
              <>
                Describe
                {!agent && (
                  // Its own line under the title, in the title's style but red.
                  <span className="ui-field-label ai-no-agent" data-testid="ai-no-agent">
                    <Link to={`/u/${encodeURIComponent(user.username)}?tab=ai`}>Add an Agent Provider</Link> to use AI features
                  </span>
                )}
              </>
            }
            aria-label="Describe"
            rows={3}
            maxLength={TEXT_MAX_LENGTH}
            value={description}
            placeholder={initial}
            disabled={!agent}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="ai-describe"
          />
          <TextField
            label="Title (required)"
            value={title}
            maxLength={MEME_TITLE_MAX_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a title"
            required
            disabled={create.busy}
            data-testid="ai-title"
          />
          <Inline justify="between">
            <Inline>
              <Button icon={<Icon name="sparkle" />} disabled={!canUpdate || create.busy} onClick={() => run("update")} data-testid="ai-update">
                {label("update", "Update")}
              </Button>
              <Button disabled={!source || create.busy} onClick={() => run("editor")} data-testid="ai-full-editor">
                {label("editor", "Full editor")}
              </Button>
              {create.busy && (
                <Button variant="quiet" onClick={create.cancel} data-testid="ai-cancel">
                  Cancel
                </Button>
              )}
            </Inline>
            <Button variant="primary" disabled={!draft || !title.trim() || create.busy} onClick={() => run("publish")} data-testid="ai-publish">
              {label("publish", "Publish")}
            </Button>
          </Inline>
          {create.error !== null && <ErrorView error={create.error} testId="ai-error" />}
        </Stack>
      </div>
    </Panel>
  );
}

