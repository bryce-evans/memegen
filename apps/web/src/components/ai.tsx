import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  composedSize,
  composeFrame,
  context2d,
  decodeMedia,
  ensureLayerFonts,
  ensureLayerImages,
  exportMeme,
  type DecodedMedia,
} from "@memegen/render";
import {
  AI_EDIT_FONTS_MAX,
  AI_PROVIDERS,
  aiEditTarget,
  aiImageUpdate,
  applyAiEdit,
  extensionForMime,
  layerLabels,
  limitViolations,
  MAX_TAGS,
  TEXT_MAX_LENGTH,
  type AiProviderId,
  type Asset,
  type Layer,
  type Template,
} from "@memegen/shared";
import { Button, Icon, Inline, NavItem, NavList, Panel, SelectField, Spinner, Stack, Text, TextArea, TextField } from "@memegen/ui";
import {
  ApiError,
  assetUrl,
  countTemplates,
  createMeme,
  createTemplate,
  fetchAssetBlob,
  generateAiImage,
  getLimits,
  listFonts,
  listTemplates,
  requestAiEdit,
  uploadAsset,
} from "../api.ts";
import { ROLE_PROVIDER_IDS, useAiSettings, validModel, type AiConfig, type AiRole } from "../aiSettings.ts";
import { useUser } from "../auth.tsx";
import { fileSlug, nameFromFile } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { ErrorView, MediaView } from "./common.tsx";
import { defaultFontId, templateLayers } from "./editor/session.ts";

/** The settings' two roles, in sidebar order. */
const ROLES: { role: AiRole; label: string }[] = [
  { role: "image", label: "Image Generator" },
  { role: "text", label: "Agent Provider" },
];

const providerLabel = (config: AiConfig | null) => AI_PROVIDERS.find((p) => p.id === config?.provider)?.label;

/**
 * Profile (owner only): the user's two AI settings, the Image Generator and the Agent Provider, each a provider, the
 * user's own API key, and an optional model, kept in this browser. The sidebar picks one; the form edits it.
 */
export function AiAgentsPanel() {
  const user = useUser();
  const { settings, save } = useAiSettings(user.id);
  const [role, setRole] = useState<AiRole>("image");

  return (
    <Panel heading="API Keys" data-testid="ai-agents">
      <Text tone="muted">
        The Agent Provider writes your memes in the Quick Creator on the Create page; the Image Generator makes the
        changes it asks for to the picture. Both use your own API keys, which stay in this browser and are sent only
        with your AI requests; memegen never stores them.
      </Text>
      <div className="ai-settings">
        <NavList className="ai-settings-roles" aria-label="AI settings">
          {ROLES.map((r) => (
            <NavItem
              key={r.role}
              as="button"
              type="button"
              className="ai-settings-role"
              active={role === r.role}
              aria-pressed={role === r.role}
              onClick={() => setRole(r.role)}
              data-testid={`ai-role-${r.role}`}
              data-set={settings[r.role] !== null}
            >
              {r.label}: {providerLabel(settings[r.role]) ?? "UNSET"}
            </NavItem>
          ))}
        </NavList>
        {role === "text" ? (
          <AiConfigForm key="text" label="Agent Provider" providers={ROLE_PROVIDER_IDS.text} current={settings.text} onSave={(c) => save("text", c)} />
        ) : (
          <AiConfigForm key="image" label="Image Generator" providers={ROLE_PROVIDER_IDS.image} current={settings.image} onSave={(c) => save("image", c)} />
        )}
      </div>
    </Panel>
  );
}

/** One role's provider (from those the role may use), key (blank keeps the stored one), and model; Clear unsets it. */
function AiConfigForm<P extends AiProviderId>({
  label,
  providers,
  current,
  onSave,
}: {
  label: string;
  providers: readonly P[];
  current: AiConfig<P> | null;
  onSave: (config: AiConfig<P> | null) => void;
}) {
  const options = AI_PROVIDERS.filter((p) => (providers as readonly AiProviderId[]).includes(p.id));
  const [provider, setProvider] = useState<P>(current?.provider ?? providers[0]!);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(current?.model ?? "");
  const info = options.find((p) => p.id === provider) ?? options[0]!;
  const apiKey = key.trim() || current?.apiKey || "";
  const valid = apiKey !== "" && validModel(model);

  return (
    <form
      className="ai-settings-form"
      aria-label={label}
      data-testid="ai-config-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({ provider, apiKey, model: model.trim() });
        setKey("");
      }}
    >
      <Stack>
        <SelectField
          label="Provider"
          value={provider}
          onChange={(e) => setProvider(providers.find((p) => p === e.target.value) ?? provider)}
          data-testid="ai-config-provider"
        >
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <TextField
          type="password"
          autoComplete="off"
          label="API key"
          placeholder={current ? "Keep the current key…" : "Paste API key…"}
          description={
            <a href={info.keyUrl} target="_blank" rel="noreferrer">
              Get an API key from {info.label}
            </a>
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
          data-testid="ai-config-key"
        />
        <TextField
          label="Model"
          placeholder="Provider default"
          value={model}
          error={validModel(model) ? undefined : "Letters, digits, and . _ : - only"}
          onChange={(e) => setModel(e.target.value)}
          data-testid="ai-config-model"
        />
        <Inline>
          <Button type="submit" variant="primary" disabled={!valid} data-testid="ai-config-save">
            Save
          </Button>
          {current && (
            <Button
              variant="quiet"
              onClick={() => {
                onSave(null);
                setKey("");
                setModel("");
              }}
              data-testid="ai-config-clear"
            >
              Clear
            </Button>
          )}
        </Inline>
      </Stack>
    </form>
  );
}

/** Template search results shown under the Creator's search field. */
const PICKER_LIMIT = 6;

/** One line of a box's text: line breaks would split it in the directions. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

/**
 * The Describe field's placeholder for a template: each text box's text after its label (the top section's first, as
 * its layer is), so the agent knows which box each part goes in. Templates without boxes get the editor's own defaults.
 */
function startingText(template: Template): string {
  const layers = templateLayers(template, null);
  return aiEditTarget(layers, layerLabels(layers))
    .boxes.map((b) => `${b.label}: ${oneLine(b.text)}`)
    .join("\n");
}

/** A random browsable template to start from; multi-panel ones (no single image) are skipped. */
async function randomTemplate(): Promise<Template | null> {
  const { count } = await countTemplates();
  for (let tries = 0; count > 0 && tries < 3; tries++) {
    const [pick] = (await listTemplates({ offset: Math.floor(Math.random() * count), limit: 1 })).items;
    if (pick && pick.kind !== "multi") return pick;
  }
  return (await listTemplates({ kind: "single", limit: 1 })).items[0] ?? null;
}

/** An image the Image Generator made, not uploaded yet, and the prompt it was made from (its file's name). */
interface DraftImage {
  blob: Blob;
  prompt: string;
}

/**
 * What Update made of a template so far: its layers with the agent's text, and its edited image (null: the template's
 * own). `updates` counts the Updates applied, for the canvas to say which one it drew.
 */
interface Draft {
  layers: Layer[];
  image: DraftImage | null;
  updates: number;
}

/** The Creator's actions: ask the agent, open the result in the editor, or post it. */
type Action = "update" | "editor" | "publish";

/**
 * Create page, top: a template (a random one to begin with) shown on a canvas, and directions for the meme (starting
 * as the template's own text). Update sends the directions to the user's Agent Provider as a `quick-creator/2`
 * request on the canvas's current state; its `ADD_TEXT` actions rewrite the text boxes (never their placement or
 * timing), and its `UPDATE_IMAGE`, only offered when an Image Generator is set, goes to that generator. The canvas then
 * shows the result, and another Update builds on it. Full editor opens the result (or the template as is) in the
 * editor; Publish renders and posts it, titled and tagged like the template, once an Update made one. An edited image
 * is uploaded only then, becoming a new template like any new media.
 */
export function AiCreator() {
  const user = useUser();
  const navigate = useNavigate();
  const { settings } = useAiSettings(user.id);
  const { text: agent, image: generator } = settings;
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [description, setDescription] = useState("");
  // The Describe field's placeholder for the chosen template: its boxes' own text, never sent as directions.
  const [initial, setInitial] = useState("");
  const [step, setStep] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const q = useDebounced(search.trim(), 300);
  const results = useAsync(`ai-templates:${q}`, () => (q ? listTemplates({ q, limit: PICKER_LIMIT }) : Promise.resolve(null)));
  const start = useAsync("ai-random-template", randomTemplate);
  const create = useAction();
  const words = description.trim();
  // Update needs the Agent Provider and typed directions other than the placeholder's own text; Publish needs an
  // Update's result; Full editor needs neither (the template opens as is).
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

  /**
   * Ask the Agent Provider to apply the directions to `current` (else the template as is), and have the Image
   * Generator make any image update it asks for.
   */
  async function update(from: Template, current: Draft | null, signal: AbortSignal): Promise<Draft> {
    if (!agent) throw new Error("Add an Agent Provider in your profile's API Keys tab.");
    const [image, fonts] = await Promise.all([
      current?.image?.blob ?? (from.asset.kind === "image" ? fetchAssetBlob(from.asset, signal) : null),
      listFonts(),
    ]);
    const base = current?.layers ?? templateLayers(from, defaultFontId(fonts.items));
    setStep("Asking the agent…");
    const edit = await requestAiEdit(
      {
        provider: agent.provider,
        model: agent.model,
        request: {
          directions: words,
          ...aiEditTarget(base, layerLabels(base)),
          fonts: fonts.items.slice(0, AI_EDIT_FONTS_MAX).map((f) => ({ id: f.id, name: f.name })),
          // Without an Image Generator the agent isn't offered UPDATE_IMAGE, and the API drops any it sends.
          canUpdateImage: generator !== null,
        },
      },
      image,
      agent.apiKey,
      signal,
    );
    const layers = applyAiEdit(base, edit);
    const updates = (current?.updates ?? 0) + 1;
    // The API only returns UPDATE_IMAGE with an Image Generator and the image: GIF/video templates take text only.
    const prompt = aiImageUpdate(edit);
    if (!prompt || !image || !generator) return { layers, image: current?.image ?? null, updates };
    setStep("Editing the image…");
    const edited = await generateAiImage({ provider: generator.provider, prompt, model: generator.model }, image, generator.apiKey, signal);
    return { layers, image: { blob: edited, prompt }, updates };
  }

  /** Upload an edited image as new media, named after its prompt. */
  function uploadImage({ blob, prompt }: DraftImage, signal: AbortSignal): Promise<Asset> {
    setStep("Uploading…");
    return uploadAsset(blob, `${fileSlug(prompt)}${extensionForMime(blob.type) ?? ".png"}`, undefined, signal);
  }

  /** The Template Editor on the draft: its edited image as new media, else the template, with the draft's layers. */
  async function openEditor(from: Template, current: Draft | null, signal: AbortSignal) {
    if (!current) return navigate(`/create?template=${from.id}`);
    const state = { layers: current.layers };
    if (!current.image) return navigate(`/create?template=${from.id}`, { state });
    const asset = await uploadImage(current.image, signal);
    if (!signal.aborted) navigate(`/create?newTemplate=${asset.id}`, { state });
  }

  /**
   * Render the draft with the export's own pipeline and post it, titled and tagged like its template. An edited image
   * is saved as a new template first (as the Template Editor would, with the draft's boxes as its defaults).
   */
  async function publish(from: Template, { layers, image }: Draft, signal: AbortSignal): Promise<string> {
    const limits = await getLimits();
    const uploaded = image ? await uploadImage(image, signal) : null;
    const template = uploaded
      ? await createTemplate({ name: nameFromFile(uploaded.filename), assetId: uploaded.id, defaultLayers: layers, tags: from.tags })
      : from;
    const { asset } = template;
    if (asset.kind === "font") throw new Error("template asset is a font, not media");
    setStep("Rendering…");
    const media = await decodeMedia(image?.blob ?? (await fetchAssetBlob(asset, signal)), asset.kind);
    let out;
    try {
      const [, images] = await Promise.all([ensureLayerFonts(layers, assetUrl), ensureLayerImages(layers, assetUrl)]);
      out = await exportMeme(media, layers, images, limits, { signal });
    } finally {
      media.dispose();
    }
    const tooBig = limitViolations(out.blob.size, null, limits);
    if (tooBig.length) throw new ApiError(413, "the rendered meme is over the upload limit", tooBig);
    setStep("Uploading…");
    const output = await uploadAsset(out.blob, `${fileSlug(template.name)}${out.extension}`, undefined, signal);
    setStep("Publishing…");
    const meme = await createMeme({
      title: template.name,
      templateId: template.id,
      outputAssetId: output.id,
      layers,
      visibility: "public",
      post: true,
      tags: template.tags.slice(0, MAX_TAGS),
    });
    return meme.id;
  }

  function run(to: Action) {
    if (!source) return;
    const from = source;
    const current = draft;
    setAction(to);
    setStep("Working…");
    void create.run(async (signal) => {
      if (to === "update") {
        const next = await update(from, current, signal);
        if (!signal.aborted) setDraft(next);
      } else if (to === "editor") {
        await openEditor(from, current, signal);
      } else if (current) {
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
            <TemplateCanvas template={source} draft={draft} />
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
            placeholder="Search templates…"
            value={search}
            onChange={(e) => {
              touched.current = true;
              setSearch(e.target.value);
            }}
            data-testid="ai-template-search"
          />
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
            <Button variant="primary" disabled={!draft || create.busy} onClick={() => run("publish")} data-testid="ai-publish">
              {label("publish", "Publish")}
            </Button>
          </Inline>
          {create.error !== null && <ErrorView error={create.error} testId="ai-error" />}
        </Stack>
      </div>
    </Panel>
  );
}

/**
 * A template's first frame with its default text, or Update's draft (its layers on its edited image, if any), drawn
 * by the export's compositor (`composeFrame`), so it looks as the meme will. Templates without text boxes show the
 * editor's TOP/BOTTOM defaults. The canvas fits the preview's width and its CSS `max-height`, scaled down to whichever
 * binds. For tests, `data-ready` marks the drawn canvas and `data-updates` the draft's Update count it drew (0: none).
 */
function TemplateCanvas({ template, draft }: { template: Template; draft: Draft | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.ready = "false";
    setError(null);
    let cancelled = false;
    let media: DecodedMedia | null = null;
    (async () => {
      const { asset } = template;
      const kind = draft?.image ? "image" : asset.kind;
      if (kind === "font") throw new Error("template asset is a font, not media");
      const [decoded, fonts] = await Promise.all([
        (draft?.image ? Promise.resolve(draft.image.blob) : fetchAssetBlob(asset)).then((blob) => decodeMedia(blob, kind)),
        listFonts(),
      ]);
      if (cancelled) return decoded.dispose();
      media = decoded;
      const layers = draft?.layers ?? templateLayers(template, defaultFontId(fonts.items));
      const [frame, images] = await Promise.all([decoded.frame(0), ensureLayerImages(layers, assetUrl), ensureLayerFonts(layers, assetUrl)]);
      if (cancelled) return;
      // Fit the preview's width and the canvas's max-height, then draw at that size × devicePixelRatio; CSS shows the
      // canvas at its intrinsic aspect within the same bounds.
      const maxWidth = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
      const maxHeight = parseFloat(getComputedStyle(canvas).maxHeight) || Infinity;
      const full = composedSize(layers, decoded, maxWidth);
      const shown = Math.min(maxWidth, (maxHeight * full.width) / full.height);
      const width = Math.max(1, Math.round(shown * (window.devicePixelRatio || 1)));
      const { height } = composedSize(layers, decoded, width);
      canvas.width = width;
      canvas.height = height;
      composeFrame(context2d(canvas), frame, layers, images, width, height, 0);
      canvas.dataset.updates = String(draft?.updates ?? 0);
      canvas.dataset.ready = "true";
    })().catch((err: unknown) => !cancelled && setError(err));
    return () => {
      cancelled = true;
      media?.dispose();
    };
  }, [template, draft]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="ai-creator-canvas"
        aria-label={draft ? `${template.name} as updated` : `${template.name} with its default text`}
        data-testid="ai-canvas"
        data-template-id={template.id}
      />
      {error !== null && <ErrorView error={error} />}
    </>
  );
}
