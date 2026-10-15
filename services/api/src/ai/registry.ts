import type { AiProviderId } from "@memegen/shared";
import { GeminiImageProvider } from "./gemini.ts";
import { OpenAiImageProvider } from "./openai.ts";
import type { AiImageProvider } from "./types.ts";

export type AiProviders = Readonly<Record<AiProviderId, AiImageProvider>>;

/**
 * One adapter per id in `AI_PROVIDERS` (add a provider in both places). Users bring their own keys, so the server
 * needs no secrets; env only picks models and, for proxies or gateways, base URLs.
 */
export function createAiProviders(env: NodeJS.ProcessEnv = process.env): AiProviders {
  return {
    openai: new OpenAiImageProvider({
      baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    }),
    gemini: new GeminiImageProvider({
      baseUrl: env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      model: env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1",
    }),
  };
}
