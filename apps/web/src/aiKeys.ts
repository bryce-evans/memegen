import { useCallback, useState } from "react";
import { AI_PROVIDER_IDS, type AiProviderId } from "@memegen/shared";

/**
 * Users' own AI provider API keys, kept in this browser only (localStorage, per memegen user) and sent with each AI
 * request. The server never stores them, so they stay out of the database and snapshots.
 */
export type AiKeys = Partial<Record<AiProviderId, string>>;

const storageKey = (userId: string) => `memegen.aiKeys.${userId}`;

function readKeys(userId: string): AiKeys {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const keys: AiKeys = {};
    for (const [name, value] of Object.entries(parsed)) {
      const id = AI_PROVIDER_IDS.find((p) => p === name);
      if (id && typeof value === "string" && value) keys[id] = value;
    }
    return keys;
  } catch {
    return {};
  }
}

/** The signed-in user's keys and a setter (`null` or "" forgets one). */
export function useAiKeys(userId: string): [AiKeys, (provider: AiProviderId, key: string | null) => void] {
  const [keys, setKeys] = useState(() => readKeys(userId));
  const setKey = useCallback(
    (provider: AiProviderId, key: string | null) => {
      const next = { ...readKeys(userId) };
      const trimmed = key?.trim();
      if (trimmed) next[provider] = trimmed;
      else delete next[provider];
      localStorage.setItem(storageKey(userId), JSON.stringify(next));
      setKeys(next);
    },
    [userId],
  );
  return [keys, setKey];
}
