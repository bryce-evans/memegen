import { z } from "zod";
import { LAYER_NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from "./limits.ts";
import type { Layer } from "./types.ts";

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
 * The Quick Creator's agent contract. The agent sees the template's default text boxes and answers with actions: at
 * most one `UPDATE_IMAGE` (an edit prompt for the picture), then `ADD_TEXT`s that set those boxes' text and font.
 * Positions, sizes, timing, and new boxes are not in the actions' shape, so an agent cannot change them.
 */
export const AI_EDIT_SPEC = "quick-creator/2";

/**
 * One default text box (the top section's included): its layer id, editor label, text, and font. `x`/`y` (box
 * center; for the top section, a fraction of its band) only say where it sits.
 */
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
 * What the agent acts on: the user's directions, the template's text boxes, the fonts it may pick from, and whether
 * it may `UPDATE_IMAGE` (the user has an Image Generator; the API also needs the still image attached).
 */
export const aiEditRequestSchema = z.object({
  directions: z.string().trim().min(1).max(TEXT_MAX_LENGTH),
  boxes: z.array(aiEditBoxSchema).max(50),
  fonts: z.array(z.object({ id: z.uuid(), name: z.string().max(200) })).max(AI_EDIT_FONTS_MAX),
  canUpdateImage: z.boolean(),
});
export type AiEditRequest = z.output<typeof aiEditRequestSchema>;

/**
 * Text fields of `POST /api/ai/edit` (multipart): the provider, an optional text model,
 * and `request` (JSON, `aiEditRequestSchema`). The optional `image` file is the still media; without it, the agent
 * never gets to `UPDATE_IMAGE`.
 */
export const aiEditFieldsSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  model: aiModelSchema,
  request: aiEditRequestSchema,
});
export type AiEditFields = z.input<typeof aiEditFieldsSchema>;

/** `UPDATE_IMAGE(prompt)`: change the template's picture itself with the user's Image Generator. */
export interface AiUpdateImage {
  action: "UPDATE_IMAGE";
  /** The change to the picture only, never caption text; ≤ `AI_PROMPT_MAX_LENGTH`. */
  prompt: string;
}

/** `ADD_TEXT`'s `style`: a font from the request's `fonts`. Case, color, and outline stay the box's own. */
export interface AiTextStyle {
  fontId: string;
}

/** `ADD_TEXT(text, position?, style?)`: set one default box's text, and optionally its font. */
export interface AiAddText {
  action: "ADD_TEXT";
  /** The box's new text; "" blanks it. */
  text: string;
  /** The box's id. The agent may omit it (next box not yet given text); the API always resolves it. */
  position: string;
  /** null keeps the box's font. */
  style: AiTextStyle | null;
}

export type AiAction = AiUpdateImage | AiAddText;

/**
 * The agent's answer, checked by the API: `[UPDATE_IMAGE?, ...ADD_TEXT]`. At most one `UPDATE_IMAGE`, first, only
 * when the request allowed it; each `ADD_TEXT` on a distinct requested box with a listed font, changes that change
 * nothing dropped. May be empty.
 */
export interface AiEdit {
  actions: AiAction[];
}

/** The request's view of `layers`: every text box, the top section's included, in layer order. */
export function aiEditTarget(layers: readonly Layer[], labels: readonly string[]): Pick<AiEditRequest, "boxes"> {
  const boxes = layers.flatMap((l, i) =>
    l.type === "text" ? [{ id: l.id, label: labels[i] ?? "", text: l.text, fontId: l.fontAssetId, x: l.x, y: l.y }] : [],
  );
  return { boxes };
}

/** The edit's `UPDATE_IMAGE` prompt, or null when it has none. */
export function aiImageUpdate(edit: AiEdit): string | null {
  return edit.actions.find((a): a is AiUpdateImage => a.action === "UPDATE_IMAGE")?.prompt ?? null;
}

/**
 * `layers` with the edit's `ADD_TEXT`s applied: box text and fonts replaced by id. `UPDATE_IMAGE` is the caller's
 * (it needs the Image Generator). Everything else (positions, sizes, timing, other layers) is kept as it was.
 */
export function applyAiEdit(layers: readonly Layer[], edit: AiEdit): Layer[] {
  const texts = new Map(edit.actions.flatMap((a) => (a.action === "ADD_TEXT" ? [[a.position, a] as const] : [])));
  return layers.map((l) => {
    const add = l.type === "text" ? texts.get(l.id) : undefined;
    if (!add || l.type !== "text") return l;
    return add.style ? { ...l, text: add.text, fontAssetId: add.style.fontId } : { ...l, text: add.text };
  });
}
