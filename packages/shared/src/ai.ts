import { z } from "zod";
import { TEXT_BOX_MIN, TEXT_MAX_LENGTH } from "./limits.ts";

/** Image models a user can bring their own API key for; the API holds one adapter per id. */
export const AI_PROVIDERS = [
  { id: "openai", label: "OpenAI GPT Image", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "gemini", label: "Google Nano Banana (Gemini)", keyUrl: "https://aistudio.google.com/apikey" },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];
export const AI_PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id) as [AiProviderId, ...AiProviderId[]];

/** Request header carrying the caller's own provider API key. The API forwards it and never stores it. */
export const AI_KEY_HEADER = "x-ai-key";

/** Characters in one AI image prompt. */
export const AI_PROMPT_MAX_LENGTH = 4000;

/**
 * Text fields of `POST /api/ai/images` (multipart): the provider and the prompt. The `image` file field is the
 * background the model sees as context: a still png/jpg/webp within the upload byte cap.
 */
export const aiImageFieldsSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  prompt: z.string().trim().min(1).max(AI_PROMPT_MAX_LENGTH),
});
export type AiImageFields = z.input<typeof aiImageFieldsSchema>;

/** Captions one AI placement may return. */
export const AI_CAPTIONS_MAX = 8;
/** A caption box: center x/y and size as fractions of the media, like a text layer's anchor and maxWidth/maxHeight. */
export const aiCaptionBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(TEXT_BOX_MIN).max(1),
  height: z.number().min(TEXT_BOX_MIN).max(1),
});
export const aiCaptionSchema = aiCaptionBoxSchema.extend({ text: z.string().trim().min(1).max(TEXT_MAX_LENGTH) });
export type AiCaption = z.output<typeof aiCaptionSchema>;
/**
 * Text fields of `POST /api/ai/captions` (multipart). `text` is the user's description: the meme's text, and maybe a
 * change to the image. `boxes` (JSON) are the template's own text boxes, as hints.
 */
export const aiCaptionsFieldsSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  text: z.string().trim().min(1).max(TEXT_MAX_LENGTH),
  boxes: z.array(aiCaptionBoxSchema.extend({ text: z.string().max(TEXT_MAX_LENGTH) })).max(50).default([]),
});
export type AiCaptionsFields = z.input<typeof aiCaptionsFieldsSchema>;
/**
 * The description read by the model: its text as placed captions (possibly none), and any change it asks for to the
 * image itself (an `/api/ai/images` prompt, at most `AI_PROMPT_MAX_LENGTH`), else null. Never both empty.
 */
export interface AiCaptionsResponse {
  captions: AiCaption[];
  modification: string | null;
}
