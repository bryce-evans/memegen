import { useCallback, useState } from "react";
import { AI_AGENT_NAME_MAX_LENGTH, AI_PROVIDER_IDS, AI_PROVIDERS, aiModelSchema, type AiProviderId } from "@memegen/shared";

/**
 * Users' Quick Creator agents: a name, a provider with the user's own API key, the agent's own instructions (its
 * style and voice), and optional text/image model overrides (blank: the server's default for the provider). Kept in
 * this browser only (localStorage, per memegen user) and sent with each AI request; the server never stores them, so
 * keys stay out of the database and snapshots.
 */
export interface AiAgent {
  id: string;
  name: string;
  provider: AiProviderId;
  apiKey: string;
  instructions: string;
  textModel: string;
  imageModel: string;
}

/** Checks a model override the way the API will, so a bad one is caught in the form. */
export const validModel = (model: string) => aiModelSchema.safeParse(model).success;

const storageKey = (userId: string) => `memegen.aiAgents.${userId}`;
/** Where provider keys were kept before agents; read once and turned into one agent per provider. */
const legacyKeysKey = (userId: string) => `memegen.aiKeys.${userId}`;

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const isString = (v: unknown): v is string => typeof v === "string";

/** A stored agent that still has every field; anything else (hand-edited, older shapes) is dropped. */
function parseAgent(value: unknown): AiAgent | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  const provider = AI_PROVIDER_IDS.find((p) => p === a.provider);
  if (!provider || !isString(a.id) || !isString(a.name) || !isString(a.apiKey) || !a.name.trim() || !a.apiKey.trim()) return null;
  const optional = (v: unknown) => (isString(v) ? v : "");
  return {
    id: a.id,
    name: a.name.slice(0, AI_AGENT_NAME_MAX_LENGTH),
    provider,
    apiKey: a.apiKey,
    instructions: optional(a.instructions),
    textModel: optional(a.textModel),
    imageModel: optional(a.imageModel),
  };
}

function readAgents(userId: string): AiAgent[] {
  const stored = readJson(storageKey(userId));
  const agents = Array.isArray(stored) ? stored.flatMap((a) => parseAgent(a) ?? []) : [];
  const legacy = readJson(legacyKeysKey(userId));
  if (!legacy || typeof legacy !== "object") return agents;
  const migrated = AI_PROVIDERS.flatMap((p) => {
    const key: unknown = (legacy as Record<string, unknown>)[p.id];
    return isString(key) && key.trim()
      ? [{ id: crypto.randomUUID(), name: p.label, provider: p.id, apiKey: key.trim(), instructions: "", textModel: "", imageModel: "" }]
      : [];
  });
  const next = [...agents, ...migrated];
  writeAgents(userId, next);
  localStorage.removeItem(legacyKeysKey(userId));
  return next;
}

function writeAgents(userId: string, agents: AiAgent[]): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(agents));
}

export interface AiAgents {
  agents: AiAgent[];
  /** Adds the agent, or replaces the one with its id. */
  save(agent: AiAgent): void;
  remove(id: string): void;
}

/** The signed-in user's agents, in the order they were added. */
export function useAiAgents(userId: string): AiAgents {
  const [agents, setAgents] = useState(() => readAgents(userId));
  const update = useCallback(
    (change: (current: AiAgent[]) => AiAgent[]) => {
      const next = change(readAgents(userId));
      writeAgents(userId, next);
      setAgents(next);
    },
    [userId],
  );
  const save = useCallback(
    (agent: AiAgent) => update((all) => (all.some((a) => a.id === agent.id) ? all.map((a) => (a.id === agent.id ? agent : a)) : [...all, agent])),
    [update],
  );
  const remove = useCallback((id: string) => update((all) => all.filter((a) => a.id !== id)), [update]);
  return { agents, save, remove };
}
