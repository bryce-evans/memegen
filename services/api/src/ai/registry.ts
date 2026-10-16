import type { AiProviderId } from "@memegen/shared";
import { GeminiProvider } from "./gemini.ts";
import { OpenAiProvider } from "./openai.ts";
import type { AiProvider } from "./types.ts";

export type AiProviders = Readonly<Record<AiProviderId, AiProvider>>;

/**
 * One adapter per id in `AI_PROVIDERS` (add a provider in both places). Users bring their own keys, so the server
 * needs no secrets; env only picks models and, for proxies or gateways, base URLs.
 */
export function createAiProviders(env: NodeJS.ProcessEnv = process.env): AiProviders {
  return {
    openai: new OpenAiProvider({
      baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      imageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      textModel: env.OPENAI_TEXT_MODEL || "gpt-5-mini",
    }),
    gemini: new GeminiProvider({
      baseUrl: env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      imageModel: env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1",
      textModel: env.GEMINI_TEXT_MODEL || "gemini-2.5-flash",
    }),
  };
}
