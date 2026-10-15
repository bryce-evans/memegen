import { z } from "zod";

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
