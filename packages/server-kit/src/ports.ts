/** Shared listener defaults; domain-specific configuration stays with its service. */
export function servicePorts(env: NodeJS.ProcessEnv) {
  return {
    api: portFromEnv(env, "API_PORT", 4000),
    storage: portFromEnv(env, "STORAGE_PORT", 4001),
    search: portFromEnv(env, "SEARCH_PORT", 4002),
  };
}

export function portFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be an integer from 1 to 65535`);
  return value;
}
