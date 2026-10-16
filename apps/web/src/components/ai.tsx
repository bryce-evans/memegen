import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { composedSize, composeFrame, context2d, decodeMedia, ensureLayerFonts, ensureLayerImages, type DecodedMedia } from "@memegen/render";
import {
  AI_PROVIDERS,
  extensionForMime,
  TEXT_BOX_MIN,
  TEXT_MAX_LENGTH,
  topBottomLayers,
  type AiCaptionsFields,
  type AiProviderId,
  type Template,
} from "@memegen/shared";
import { Badge, Button, Icon, Inline, Panel, SelectField, Spinner, Stack, Text, TextArea, TextField } from "@memegen/ui";
import { assetUrl, countTemplates, fetchAssetBlob, generateAiImage, listFonts, listTemplates, placeAiCaptions, uploadAsset } from "../api.ts";
import { useAiKeys } from "../aiKeys.ts";
import { useUser } from "../auth.tsx";
import { fileSlug } from "../media.ts";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { useDebounced } from "../useDebounced.ts";
import { ErrorView, MediaView } from "./common.tsx";
import { defaultFontId } from "./editor/session.ts";

/** Profile (owner only): connect AI image providers with the user's own API keys, kept in this browser. */
export function AiKeysPanel() {
  const user = useUser();
  const [keys, setKey] = useAiKeys(user.id);
  const [drafts, setDrafts] = useState<Partial<Record<AiProviderId, string>>>({});

  return (
    <Panel heading="AI image providers" data-testid="ai-keys">
      <Text tone="muted">
        Add your own API key to generate images from a prompt and a background on the Create page. Keys stay in this
        browser and are sent only with your AI requests; memegen never stores them.
      </Text>
      <Stack>
        {AI_PROVIDERS.map((p) => {
          const connected = Boolean(keys[p.id]);
          const draft = drafts[p.id] ?? "";
          return (
            <form
              key={p.id}
              className="ai-key-row"
              onSubmit={(e) => {
                e.preventDefault();
                setKey(p.id, draft);
                setDrafts((d) => ({ ...d, [p.id]: "" }));
              }}
            >
              <Inline>
                <Text as="span">{p.label}</Text>
                <Badge tone={connected ? "success" : "neutral"} data-testid={`ai-key-status-${p.id}`} data-connected={connected}>
                  {connected ? "Connected" : "Not connected"}
                </Badge>
                <a href={p.keyUrl} target="_blank" rel="noreferrer">
                  Get a key
                </a>
              </Inline>
              <Inline>
                <TextField
                  type="password"
                  autoComplete="off"
                  aria-label={`${p.label} API key`}
                  placeholder={connected ? "Replace key…" : "Paste API key…"}
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  data-testid={`ai-key-input-${p.id}`}
                />
                <Button type="submit" disabled={!draft.trim()} data-testid={`ai-key-save-${p.id}`}>
                  Save
                </Button>
                {connected && (
                  <Button variant="quiet" onClick={() => setKey(p.id, null)} data-testid={`ai-key-remove-${p.id}`}>
                    Remove
                  </Button>
                )}
              </Inline>
            </form>
          );
        })}
      </Stack>
    </Panel>
  );
}

/** Template search results shown under the Creator's search field. */
const PICKER_LIMIT = 6;

/** The template's own text boxes, as placement hints for the model (clamped into the media). */
function captionHints(template: Template): AiCaptionsFields["boxes"] {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return template.defaultLayers.flatMap((l) =>
    l.type === "text" && !l.topSection
      ? [{ x: clamp(l.x, 0, 1), y: clamp(l.y, 0, 1), width: clamp(l.maxWidth, TEXT_BOX_MIN, 1), height: clamp(l.maxHeight, TEXT_BOX_MIN, 1), text: l.text }]
      : [],
  );
}

/**
 * The Text field's starting value for a template: its top and bottom text, labelled so the model knows where each
 * goes. Templates without boxes get the editor's own defaults; one box is the top text.
 */
function startingText(template: Template): string {
  const boxes = template.defaultLayers.flatMap((l) => (l.type === "text" && !l.topSection ? [l.text.replace(/\s*\n\s*/g, " ")] : []));
  const top = boxes.length ? boxes[0] : "TOP TEXT";
  const bottom = boxes.length > 1 ? boxes.at(-1) : boxes.length ? "" : "BOTTOM TEXT";
  return `top text: ${top}\nbottom text: ${bottom}`;
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
 * Create page, top: a template (a random one to begin with) shown on a canvas, and a description of the meme
 * (starting as the template's own text). The description goes to the chosen AI provider, which splits its text into
 * placed captions and pulls out any change it asks for to the image; that change goes to the same provider as an image
 * edit, whose result becomes a new template like any new media. The editor then opens prefilled. AI calls use the
 * user's own key; with no description, the template simply opens.
 */
export function AiCreator() {
  const user = useUser();
  const navigate = useNavigate();
  const [keys] = useAiKeys(user.id);
  const [provider, setProvider] = useState<AiProviderId>(() => AI_PROVIDERS.find((p) => keys[p.id])?.id ?? AI_PROVIDERS[0].id);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<Template | null>(null);
  const [description, setDescription] = useState("");
  const [step, setStep] = useState("");
  const q = useDebounced(search.trim(), 300);
  const results = useAsync(`ai-templates:${q}`, () => (q ? listTemplates({ q, limit: PICKER_LIMIT }) : Promise.resolve(null)));
  const start = useAsync("ai-random-template", randomTemplate);
  const create = useAction();
  const apiKey = keys[provider];
  const hasAnyKey = AI_PROVIDERS.some((p) => keys[p.id]);
  const words = description.trim();
  const blocked = !source || (words !== "" && !apiKey);

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
      // No description: the template simply opens.
      if (!words || !apiKey) {
        navigate(`/create?template=${from.id}`);
        return;
      }
      const image = from.asset.kind === "image" ? await fetchAssetBlob(from.asset, signal) : null;
      setStep("Reading the description…");
      const placed = await placeAiCaptions({ provider, text: words, boxes: captionHints(from) }, image, apiKey, signal);
      const state = placed.captions.length ? { captions: placed.captions } : undefined;
      if (!placed.modification) {
        navigate(`/create?template=${from.id}`, { state });
        return;
      }
      // Only still images can be edited; GIF/video templates take placed text only.
      if (!image) throw new Error("This template is a GIF or video, so its image can't be changed. Describe only its text.");
      setStep("Editing the image…");
      const edited = await generateAiImage({ provider, prompt: placed.modification }, image, apiKey, signal);
      // The edited image becomes a new template, named after its file: the modification.
      setStep("Uploading…");
      const asset = await uploadAsset(edited, `${fileSlug(placed.modification)}${extensionForMime(edited.type) ?? ".png"}`, undefined, signal);
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
            <SelectField
              aria-label="AI provider"
              className="ai-provider"
              value={provider}
              onChange={(e) => setProvider(AI_PROVIDERS.find((p) => p.id === e.target.value)?.id ?? provider)}
              data-testid="ai-provider"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {keys[p.id] ? "" : " (no key)"}
                </option>
              ))}
            </SelectField>
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
          {!hasAnyKey && (
            <Text size="sm" tone="danger" className="ai-no-key" data-testid="ai-no-key">
              <Link to={`/u/${encodeURIComponent(user.username)}?tab=ai`}>Add your API key</Link> in your profile to use a mod
              or text.
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
      const layers = template.defaultLayers.length ? template.defaultLayers : topBottomLayers(undefined, undefined, defaultFontId(fonts.items));
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
