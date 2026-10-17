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
 * The Describe field's placeholder for a template: each text box's text after its label (the top section's
 * first), so the agent knows which box each part goes in. Templates without boxes get the editor's own defaults.
 */
function startingText(template: Template): string {
  const layers = templateLayers(template, null);
  const { boxes, topSection } = aiEditTarget(layers, layerLabels(layers));
  const lines = boxes.map((b) => `${b.label}: ${oneLine(b.text)}`);
  return (topSection === null ? lines : [`Top section: ${oneLine(topSection)}`, ...lines]).join("\n");
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

/** What the agent made of a template: its layers (null: the template's own) and its edited image, uploaded (null: none). */
interface Draft {
  layers: Layer[] | null;
  image: Asset | null;
}

/** Where Create takes the result: straight to a posted meme, or into the editor to finish by hand. */
type Finish = "publish" | "editor";

/**
 * Create page, top: a template (a random one to begin with) shown on a canvas, and directions for the meme (starting
 * as the template's own text). The directions go to the user's Agent Provider as a `quick-creator/1` request; its
 * answer rewrites the template's text boxes and top section (never their placement or timing), and any change it asks
 * for to the picture goes to the user's Image Generator, whose result becomes a new template like any new media.
 * Publish then renders and posts the meme (titled and tagged like the template), only once the directions differ from
 * the template's placeholder text; Full editor opens it prefilled, or the template as is with no directions.
 */
export function AiCreator() {
  const user = useUser();
  const navigate = useNavigate();
  const { settings } = useAiSettings(user.id);
  const { text: agent, image: generator } = settings;
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<Template | null>(null);
  const [description, setDescription] = useState("");
  // The Describe field's placeholder for the chosen template: its boxes' own text, never publishable as directions.
  const [initial, setInitial] = useState("");
  const [step, setStep] = useState("");
  const [finish, setFinish] = useState<Finish | null>(null);
  const q = useDebounced(search.trim(), 300);
  const results = useAsync(`ai-templates:${q}`, () => (q ? listTemplates({ q, limit: PICKER_LIMIT }) : Promise.resolve(null)));
  const start = useAsync("ai-random-template", randomTemplate);
  const create = useAction();
  const words = description.trim();
  // Publish needs the Agent Provider and typed directions other than the placeholder's own text; Full editor needs
  // neither (without directions or an agent, the template opens as is).
  const blocked = !source || !agent || words === "" || words === initial.trim();

  // Set once the user searches or picks: the random starting template never replaces their choice.
  const touched = useRef(false);

  function choose(template: Template) {
    setSource(template);
    setSearch(template.name);
    setDescription("");
    setInitial(startingText(template));
  }

  // Begin with the random template, unless the user got there first.
  const random = start.data;
  useEffect(() => {
    if (random && !touched.current) choose(random);
  }, [random]);

  /** Ask the Agent Provider (if there are directions) and upload any image edit the Image Generator made. */
  async function draft(from: Template, signal: AbortSignal): Promise<Draft> {
    if (!words || !agent) return { layers: null, image: null };
    const [image, fonts] = await Promise.all([from.asset.kind === "image" ? fetchAssetBlob(from.asset, signal) : null, listFonts()]);
    const base = templateLayers(from, defaultFontId(fonts.items));
    setStep("Asking the agent…");
    const edit = await requestAiEdit(
      {
        provider: agent.provider,
        model: agent.model,
        request: {
          directions: words,
          ...aiEditTarget(base, layerLabels(base)),
          fonts: fonts.items.slice(0, AI_EDIT_FONTS_MAX).map((f) => ({ id: f.id, name: f.name })),
        },
      },
      image,
      agent.apiKey,
      signal,
    );
    const layers = applyAiEdit(base, edit);
    // The API only returns an image edit when it got an image: GIF/video templates take text changes only.
    if (!edit.imageEdit || !image) return { layers, image: null };
    if (!generator) throw new Error("The agent asked for an image edit: set an Image Generator in your profile's API Keys tab.");
    setStep("Editing the image…");
    const edited = await generateAiImage(
      { provider: generator.provider, prompt: edit.imageEdit, model: generator.model },
      image,
      generator.apiKey,
      signal,
    );
    // The edited image becomes a new template, named after its file: the image edit.
    setStep("Uploading…");
    const asset = await uploadAsset(edited, `${fileSlug(edit.imageEdit)}${extensionForMime(edited.type) ?? ".png"}`, undefined, signal);
    return { layers, image: asset };
  }

  /**
   * Render the draft with the export's own pipeline and post it, titled and tagged like its template. An edited image
   * is saved as a new template first (as the Template Editor would, with the draft's boxes as its defaults).
   */
  async function publish(from: Template, { layers: drafted, image }: Draft, signal: AbortSignal): Promise<string> {
    const [fonts, limits] = await Promise.all([listFonts(), getLimits()]);
    const layers = drafted ?? templateLayers(from, defaultFontId(fonts.items));
    const template = image
      ? await createTemplate({ name: nameFromFile(image.filename), assetId: image.id, defaultLayers: layers, tags: from.tags })
      : from;
    const { asset } = template;
    if (asset.kind === "font") throw new Error("template asset is a font, not media");
    setStep("Rendering…");
    const media = await decodeMedia(await fetchAssetBlob(asset, signal), asset.kind);
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

  function run(from: Template, to: Finish) {
    setFinish(to);
    setStep("Working…");
    void create.run(async (signal) => {
      const result = await draft(from, signal);
      if (to === "publish") {
        const memeId = await publish(from, result, signal);
        if (!signal.aborted) navigate(`/m/${memeId}`);
        return;
      }
      const state = result.layers ? { layers: result.layers } : undefined;
      navigate(result.image ? `/create?newTemplate=${result.image.id}` : `/create?template=${from.id}`, { state });
    });
  }

  return (
    <Panel heading="Quick Creator" className="ai-creator" data-testid="ai-creator">
      <div className="ai-creator-body">
        <div className="ai-creator-preview">
          {source ? (
            <TemplateCanvas template={source} />
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
          <Inline>
            <Button disabled={!source || create.busy} onClick={() => source && run(source, "editor")} data-testid="ai-full-editor">
              {create.busy && finish === "editor" ? step : "Full editor"}
            </Button>
            <Button
              variant="primary"
              icon={<Icon name="sparkle" />}
              disabled={blocked || create.busy}
              onClick={() => source && run(source, "publish")}
              data-testid="ai-publish"
            >
              {create.busy && finish === "publish" ? step : "Publish"}
            </Button>
            {create.busy && (
              <Button variant="quiet" onClick={create.cancel} data-testid="ai-cancel">
                Cancel
              </Button>
            )}
          </Inline>
          {create.error !== null && <ErrorView error={create.error} testId="ai-error" />}
        </Stack>
      </div>
    </Panel>
  );
}

/**
 * A template's first frame with its default text, drawn by the export's compositor (`composeFrame`), so it looks as
 * the meme will. Templates without text boxes show the editor's TOP/BOTTOM defaults. The canvas fits the preview's
 * width and its CSS `max-height`, scaled down to whichever binds. `data-ready` marks the drawn canvas for tests.
 */
function TemplateCanvas({ template }: { template: Template }) {
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
      const kind = asset.kind;
      if (kind === "font") throw new Error("template asset is a font, not media");
      const [decoded, fonts] = await Promise.all([fetchAssetBlob(asset).then((blob) => decodeMedia(blob, kind)), listFonts()]);
      if (cancelled) return decoded.dispose();
      media = decoded;
      const layers = templateLayers(template, defaultFontId(fonts.items));
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
      canvas.dataset.ready = "true";
    })().catch((err: unknown) => !cancelled && setError(err));
    return () => {
      cancelled = true;
      media?.dispose();
    };
  }, [template]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="ai-creator-canvas"
        aria-label={`${template.name} with its default text`}
        data-testid="ai-canvas"
        data-template-id={template.id}
      />
      {error !== null && <ErrorView error={error} />}
    </>
  );
}
