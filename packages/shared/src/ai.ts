import { z } from "zod";
import { newTopSectionLayer } from "./defaults.ts";
import { LAYER_NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from "./limits.ts";
import { topSectionLayer } from "./section.ts";
import type { Layer, TextLayer } from "./types.ts";

/**
 * Model providers a user can bring their own API key for; the API holds one adapter per id. Every provider can be the
 * Agent Provider (Quick Creator edits); only those with `image` can be the Image Generator.
 */
export const AI_PROVIDERS = [
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", image: true },
  { id: "gemini", label: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey", image: true },
  { id: "anthropic", label: "Anthropic Claude", keyUrl: "https://console.anthropic.com/settings/keys", image: false },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];
export const AI_PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id) as [AiProviderId, ...AiProviderId[]];
/** Providers that generate images (`POST /api/ai/images`). */
export type AiImageProviderId = Extract<(typeof AI_PROVIDERS)[number], { image: true }>["id"];
export const AI_IMAGE_PROVIDER_IDS = AI_PROVIDERS.flatMap((p) => (p.image ? [p.id] : [])) as [AiImageProviderId, ...AiImageProviderId[]];

/** Request header carrying the caller's own provider API key. The API forwards it and never stores it. */
export const AI_KEY_HEADER = "x-ai-key";

/** Characters in one AI image prompt. */
export const AI_PROMPT_MAX_LENGTH = 4000;

/** A provider model id overriding the server's default ("gpt-5-mini", "gemini-2.5-flash"); blank means the default. */
export const aiModelSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[\w.:-]*$/, "model ids are letters, digits, and . _ : -")
  .transform((m) => m || undefined)
  .optional();

/**
 * Text fields of `POST /api/ai/images` (multipart): an image provider, the prompt, and optionally the image model. The
 * `image` file field is the background the model sees as context: a still png/jpg/webp within the upload byte cap.
 */
export const aiImageFieldsSchema = z.object({
  provider: z.enum(AI_IMAGE_PROVIDER_IDS),
  prompt: z.string().trim().min(1).max(AI_PROMPT_MAX_LENGTH),
  model: aiModelSchema,
});
export type AiImageFields = z.input<typeof aiImageFieldsSchema>;

/**
 * The Quick Creator's agent contract. The agent sees the template's text boxes and answers with changes to those
 * boxes only (text, font), the top section's text, and an image-edit prompt. Positions, sizes, timing, and new boxes
 * are not in the answer's shape, so an agent cannot change them.
 */
export const AI_EDIT_SPEC = "quick-creator/1";

/** One editable text box: its layer id, editor label, text, and font. `x`/`y` (box center) only say where it sits. */
export const aiEditBoxSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(LAYER_NAME_MAX_LENGTH),
  text: z.string().max(TEXT_MAX_LENGTH),
  fontId: z.uuid().nullable(),
  x: z.number(),
  y: z.number(),
});
export type AiEditBox = z.output<typeof aiEditBoxSchema>;

/** Fonts one edit request may list for the agent to pick from. */
export const AI_EDIT_FONTS_MAX = 200;

/**
 * What the agent edits: the user's directions, the template's text boxes (the top section's text apart, null when
 * there is no top section), and the fonts it may pick from.
 */
export const aiEditRequestSchema = z.object({
  directions: z.string().trim().min(1).max(TEXT_MAX_LENGTH),
  boxes: z.array(aiEditBoxSchema).max(50),
  topSection: z.string().max(TEXT_MAX_LENGTH).nullable(),
  fonts: z.array(z.object({ id: z.uuid(), name: z.string().max(200) })).max(AI_EDIT_FONTS_MAX),
});
export type AiEditRequest = z.output<typeof aiEditRequestSchema>;

/**
 * Text fields of `POST /api/ai/edit` (multipart): the provider, an optional text model,
 * and `request` (JSON, `aiEditRequestSchema`). The optional `image` file is the still media; without it, `imageEdit`
 * is always null.
 */
export const aiEditFieldsSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  model: aiModelSchema,
  request: aiEditRequestSchema,
});
export type AiEditFields = z.input<typeof aiEditFieldsSchema>;

/** A change to one requested box; null leaves that field as it is. `text: ""` blanks the box. */
export interface AiEditBoxChange {
  id: string;
  text: string | null;
  fontId: string | null;
}

/**
 * The agent's answer, checked by the API: changes to requested boxes only (known ids, listed fonts), the top section's
 * text (null: unchanged; "": remove the band; text: add or rewrite it), and a prompt for changing the image (null
 * for none, always null without an image). Never empty.
 */
export interface AiEdit {
  boxes: AiEditBoxChange[];
  topSection: string | null;
  imageEdit: string | null;
}

/** The request's view of `layers`: every text box but the top section's, plus the top section's text. */
export function aiEditTarget(layers: readonly Layer[], labels: readonly string[]): Pick<AiEditRequest, "boxes" | "topSection"> {
  const section = topSectionLayer(layers);
  const boxes = layers.flatMap((l, i) =>
    l.type === "text" && l !== section ? [{ id: l.id, label: labels[i] ?? "", text: l.text, fontId: l.fontAssetId, x: l.x, y: l.y }] : [],
  );
  return { boxes, topSection: section ? section.text : null };
}

/**
 * `layers` with an edit applied: box text and fonts replaced by id, the top section added, rewritten, or removed.
 * Everything else (positions, sizes, timing, other layers) is kept as it was.
 */
export function applyAiEdit(layers: readonly Layer[], edit: AiEdit): Layer[] {
  const changes = new Map(edit.boxes.map((b) => [b.id, b]));
  const section = topSectionLayer(layers);
  const next = layers.flatMap((l): Layer[] => {
    if (l === section) {
      if (edit.topSection === "") return [];
      return [edit.topSection === null ? l : { ...l, text: edit.topSection }];
    }
    const change = l.type === "text" ? changes.get(l.id) : undefined;
    if (!change) return [l];
    const text: TextLayer = { ...(l as TextLayer) };
    if (change.text !== null) text.text = change.text;
    if (change.fontId !== null) text.fontAssetId = change.fontId;
    return [text];
  });
  if (!section && edit.topSection) next.unshift({ ...newTopSectionLayer(), text: edit.topSection });
  return next;
}
