import { useCallback, useState } from "react";
import { AI_IMAGE_PROVIDER_IDS, AI_PROVIDER_IDS, aiModelSchema, type AiImageProviderId, type AiProviderId } from "@memegen/shared";

/**
 * The user's two AI settings: the agent provider (the text model that writes the Quick Creator's edits) and the image
 * generator (the model that makes its image edits). Each is a provider, the user's own API key, and an optional model
 * (blank: the server's default for the provider). Kept in this browser only (localStorage, per memegen user) and sent
 * with each AI request; the server never stores them, so keys stay out of the database and snapshots.
 */
export interface AiConfig<P extends AiProviderId = AiProviderId> {
  provider: P;
  apiKey: string;
  model: string;
}

/** Unset roles are null. Any provider can be the agent; only image providers can be the image generator. */
export interface AiSettings {
  text: AiConfig | null;
  image: AiConfig<AiImageProviderId> | null;
}

export type AiRole = keyof AiSettings;

/** The providers each role may use, in `AI_PROVIDERS` order. */
export const ROLE_PROVIDER_IDS: { [R in AiRole]: readonly NonNullable<AiSettings[R]>["provider"][] } = {
  text: AI_PROVIDER_IDS,
  image: AI_IMAGE_PROVIDER_IDS,
};

/** Checks a model override the way the API will, so a bad one is caught in the form. */
export const validModel = (model: string) => aiModelSchema.safeParse(model).success;

const storageKey = (userId: string) => `memegen.aiSettings.${userId}`;
/** Where named agents were kept before these two settings; the first one becomes both on first read. */
const legacyAgentsKey = (userId: string) => `memegen.aiAgents.${userId}`;

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const isString = (v: unknown): v is string => typeof v === "string";

/** A stored config with one of `providers` and a key, else null (unset, hand-edited, older shapes). */
function parseConfig<P extends AiProviderId>(value: unknown, providers: readonly P[], modelField = "model"): AiConfig<P> | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  const provider = providers.find((p) => p === c.provider);
  if (!provider || !isString(c.apiKey) || !c.apiKey.trim()) return null;
  const model = c[modelField];
  return { provider, apiKey: c.apiKey, model: isString(model) ? model : "" };
}

function readSettings(userId: string): AiSettings {
  const stored = readJson(storageKey(userId));
  if (stored && typeof stored === "object") {
    const s = stored as Record<string, unknown>;
    return { text: parseConfig(s.text, ROLE_PROVIDER_IDS.text), image: parseConfig(s.image, ROLE_PROVIDER_IDS.image) };
  }
  const agents = readJson(legacyAgentsKey(userId));
  const first: unknown = Array.isArray(agents) ? agents[0] : null;
  const settings = { text: parseConfig(first, ROLE_PROVIDER_IDS.text, "textModel"), image: parseConfig(first, ROLE_PROVIDER_IDS.image, "imageModel") };
  writeSettings(userId, settings);
  localStorage.removeItem(legacyAgentsKey(userId));
  return settings;
}

function writeSettings(userId: string, settings: AiSettings): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(settings));
}

/** The signed-in user's AI settings and a setter for one role (null clears it). */
export function useAiSettings(userId: string): { settings: AiSettings; save<R extends AiRole>(role: R, config: AiSettings[R]): void } {
  const [settings, setSettings] = useState(() => readSettings(userId));
  const save = useCallback(
    <R extends AiRole>(role: R, config: AiSettings[R]) => {
      const next = { ...readSettings(userId), [role]: config };
      writeSettings(userId, next);
      setSettings(next);
    },
    [userId],
  );
  return { settings, save };
}
