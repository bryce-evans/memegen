import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { composedSize, composeFrame, context2d, decodeMedia, ensureLayerFonts, ensureLayerImages, type DecodedMedia } from "@memegen/render";
import {
  AI_EDIT_FONTS_MAX,
  AI_AGENT_NAME_MAX_LENGTH,
  AI_INSTRUCTIONS_MAX_LENGTH,
  AI_PROVIDERS,
  aiEditTarget,
  applyAiEdit,
  extensionForMime,
  layerLabels,
  TEXT_MAX_LENGTH,
  type Template,
} from "@memegen/shared";
import { Badge, Button, Icon, Inline, Panel, SelectField, Spinner, Stack, Text, TextArea, TextField } from "@memegen/ui";
import { assetUrl, countTemplates, fetchAssetBlob, generateAiImage, listFonts, listTemplates, requestAiEdit, uploadAsset } from "../api.ts";
import { useAiAgents, validModel, type AiAgent } from "../aiAgents.ts";
import { useUser } from "../auth.tsx";
import { fileSlug } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { ErrorView, MediaView } from "./common.tsx";
import { defaultFontId, templateLayers } from "./editor/session.ts";

type AgentDraft = Omit<AiAgent, "id">;
const EMPTY_DRAFT: AgentDraft = { name: "", provider: AI_PROVIDERS[0].id, apiKey: "", instructions: "", textModel: "", imageModel: "" };

/**
 * Profile (owner only): the user's Quick Creator agents. Each is a name, a provider with the user's own API key, its
 * own instructions, and optional model overrides, kept in this browser.
 */
export function AiAgentsPanel() {
  const user = useUser();
  const { agents, save, remove } = useAiAgents(user.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const current = agents.find((a) => a.id === editing);
  const provider = AI_PROVIDERS.find((p) => p.id === draft.provider) ?? AI_PROVIDERS[0];
  const set = (change: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...change }));
  const reset = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  };
  // Editing keeps the stored key unless a new one is typed.
  const apiKey = draft.apiKey.trim() || current?.apiKey || "";
  const modelError = (m: string) => (validModel(m) ? undefined : "Letters, digits, and . _ : - only");
  const valid = draft.name.trim() !== "" && apiKey !== "" && validModel(draft.textModel) && validModel(draft.imageModel);

  return (
    <Panel heading="AI agents" data-testid="ai-agents">
      <Text tone="muted">
        Agents write your memes in the Quick Creator on the Create page. Each one uses your own API key and follows its
        own instructions. Agents and keys stay in this browser and are sent only with your AI requests; memegen never
        stores them.
      </Text>
      <Stack>
        {agents.length === 0 && <Text tone="muted">No agents yet.</Text>}
        {agents.map((a) => (
          <Inline key={a.id} className="ai-agent-row" data-testid="ai-agent" data-agent-name={a.name}>
            <Text as="span">{a.name}</Text>
            <Badge tone="neutral">{AI_PROVIDERS.find((p) => p.id === a.provider)?.label}</Badge>
            <Button
              variant="quiet"
              onClick={() => {
                setEditing(a.id);
                setDraft({ ...a, apiKey: "" });
              }}
              data-testid="ai-agent-edit"
            >
              Edit
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                remove(a.id);
                if (editing === a.id) reset();
              }}
              data-testid="ai-agent-remove"
            >
              Remove
            </Button>
          </Inline>
        ))}
      </Stack>
      <form
        className="ai-agent-form"
        data-testid="ai-agent-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          save({
            id: current?.id ?? crypto.randomUUID(),
            name: draft.name.trim(),
            provider: draft.provider,
            apiKey,
            instructions: draft.instructions.trim(),
            textModel: draft.textModel.trim(),
            imageModel: draft.imageModel.trim(),
          });
          reset();
        }}
      >
        <Stack>
          <Text as="p">{current ? `Edit ${current.name}` : "Add an agent"}</Text>
          <TextField
            label="Name"
            maxLength={AI_AGENT_NAME_MAX_LENGTH}
            placeholder="Deadpan Dan"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            data-testid="ai-agent-name"
          />
          <SelectField
            label="Provider"
            value={draft.provider}
            onChange={(e) => set({ provider: AI_PROVIDERS.find((p) => p.id === e.target.value)?.id ?? draft.provider })}
            data-testid="ai-agent-provider"
          >
            {AI_PROVIDERS.map((p) => (
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
              <a href={provider.keyUrl} target="_blank" rel="noreferrer">
                Get an API key from {provider.label}
              </a>
            }
            value={draft.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            data-testid="ai-agent-key"
          />
          <TextArea
            label="Instructions"
            rows={3}
            maxLength={AI_INSTRUCTIONS_MAX_LENGTH}
            placeholder="Its style and voice, e.g. “Deadpan and lowercase; prefer Impact.”"
            value={draft.instructions}
            onChange={(e) => set({ instructions: e.target.value })}
            data-testid="ai-agent-instructions"
          />
          <div className="ai-agent-models">
            <TextField
              label="Text model"
              placeholder="Provider default"
              value={draft.textModel}
              error={modelError(draft.textModel)}
              onChange={(e) => set({ textModel: e.target.value })}
              data-testid="ai-agent-text-model"
            />
            <TextField
              label="Image model"
              placeholder="Provider default"
              value={draft.imageModel}
              error={modelError(draft.imageModel)}
              onChange={(e) => set({ imageModel: e.target.value })}
              data-testid="ai-agent-image-model"
            />
          </div>
          <Inline>
            <Button type="submit" variant="primary" disabled={!valid} data-testid="ai-agent-save">
              {current ? "Save agent" : "Add agent"}
            </Button>
            {current && (
              <Button variant="quiet" onClick={reset} data-testid="ai-agent-cancel">
                Cancel
              </Button>
            )}
          </Inline>
        </Stack>
      </form>
    </Panel>
  );
}

/** Template search results shown under the Creator's search field. */
const PICKER_LIMIT = 6;

/** One line of a box's text: line breaks would split it in the directions. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

/**
 * The Describe field's starting value for a template: each text box's text after its label (the top section's
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

/**
 * Create page, top: a template (a random one to begin with) shown on a canvas, and directions for the meme (starting
 * as the template's own text). The directions go to the chosen agent as a `quick-creator/1` request; its answer
 * rewrites the template's text boxes and top section (never their placement or timing), and any change it asks for to
 * the picture goes to the agent's provider as an image edit, whose result becomes a new template like any new media.
 * The editor then opens prefilled. With no directions, the template simply opens.
 */
export function AiCreator() {
  const user = useUser();
  const navigate = useNavigate();
  const { agents } = useAiAgents(user.id);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<Template | null>(null);
  const [description, setDescription] = useState("");
  const [step, setStep] = useState("");
  const q = useDebounced(search.trim(), 300);
  const results = useAsync(`ai-templates:${q}`, () => (q ? listTemplates({ q, limit: PICKER_LIMIT }) : Promise.resolve(null)));
  const start = useAsync("ai-random-template", randomTemplate);
  const create = useAction();
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const words = description.trim();
  const blocked = !source || (words !== "" && !agent);

  // Set once the user searches or picks: the random starting template never replaces their choice.
  const touched = useRef(false);

  function choose(template: Template) {
    setSource(template);
    setSearch(template.name);
    setDescription(startingText(template));
  }

  // Begin with the random template, unless the user got there first.
  const random = start.data;
  useEffect(() => {
    if (random && !touched.current) choose(random);
  }, [random]);

  function run(from: Template) {
    void create.run(async (signal) => {
      // No directions: the template simply opens.
      if (!words || !agent) {
        navigate(`/create?template=${from.id}`);
        return;
      }
      const { provider, apiKey } = agent;
      const [image, fonts] = await Promise.all([from.asset.kind === "image" ? fetchAssetBlob(from.asset, signal) : null, listFonts()]);
      const base = templateLayers(from, defaultFontId(fonts.items));
      setStep(`Asking ${agent.name}…`);
      const edit = await requestAiEdit(
        {
          provider,
          instructions: agent.instructions,
          model: agent.textModel,
          request: {
            directions: words,
            ...aiEditTarget(base, layerLabels(base)),
            fonts: fonts.items.slice(0, AI_EDIT_FONTS_MAX).map((f) => ({ id: f.id, name: f.name })),
          },
        },
        image,
        apiKey,
        signal,
      );
      const state = { layers: applyAiEdit(base, edit) };
      // The API only returns an image edit when it got an image: GIF/video templates take text changes only.
      if (!edit.imageEdit || !image) {
        navigate(`/create?template=${from.id}`, { state });
        return;
      }
      setStep("Editing the image…");
      const edited = await generateAiImage({ provider, prompt: edit.imageEdit, model: agent.imageModel }, image, apiKey, signal);
      // The edited image becomes a new template, named after its file: the image edit.
      setStep("Uploading…");
      const asset = await uploadAsset(edited, `${fileSlug(edit.imageEdit)}${extensionForMime(edited.type) ?? ".png"}`, undefined, signal);
      navigate(`/create?newTemplate=${asset.id}`, { state });
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
            label="Describe"
            rows={3}
            maxLength={TEXT_MAX_LENGTH}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="ai-describe"
          />
          <Inline>
            {agent && (
              <SelectField
                aria-label="Agent"
                className="ai-agent-select"
                value={agent.id}
                onChange={(e) => setAgentId(e.target.value)}
                data-testid="ai-agent-select"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </SelectField>
            )}
            <Button
              variant="primary"
              icon={<Icon name="sparkle" />}
              disabled={blocked || create.busy}
              onClick={() => source && run(source)}
              data-testid="ai-create"
            >
              {create.busy ? step : "Create"}
            </Button>
            {create.busy && (
              <Button variant="quiet" onClick={create.cancel} data-testid="ai-cancel">
                Cancel
              </Button>
            )}
          </Inline>
          {!agent && (
            <Text size="sm" tone="danger" className="ai-no-agent" data-testid="ai-no-agent">
              <Link to={`/u/${encodeURIComponent(user.username)}?tab=ai`}>Add an AI agent</Link> in your profile to have it
              write your meme.
            </Text>
          )}
          {create.error !== null && <ErrorView error={create.error} testId="ai-error" />}
        </Stack>
      </div>
    </Panel>
  );
}

/**
 * A template's first frame with its default text, drawn by the export's compositor (`composeFrame`), so it looks as
 * the meme will. Templates without text boxes show the editor's TOP/BOTTOM defaults. `data-ready` marks the drawn
 * canvas for tests.
 */
function TemplateCanvas({ template }: { template: Template }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<unknown>(null);
  const [aspect, setAspect] = useState<string | undefined>();

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
      // Drawn at the shown width × devicePixelRatio; CSS keeps the aspect ratio.
      const width = Math.max(1, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
      const { height } = composedSize(layers, decoded, width);
      canvas.width = width;
      canvas.height = height;
      setAspect(`${width} / ${height}`);
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
        style={{ aspectRatio: aspect }}
        aria-label={`${template.name} with its default text`}
        data-testid="ai-canvas"
        data-template-id={template.id}
      />
      {error !== null && <ErrorView error={error} />}
    </>
  );
}
