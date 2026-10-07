declare const __MEMEGEN_MODE__: "dev" | "prod";

/**
 * The config's `MODE`, baked in by Vite (`vite.config.ts`). Dev: username login and a skin switcher on the
 * sign-in page. Prod: an SSO placeholder and the locked `default` skin.
 */
export const DEV_MODE = __MEMEGEN_MODE__ === "dev";
